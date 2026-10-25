import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  pendingListeners: new Set<() => void>(), transferListeners: new Set<() => void>(), spaceListeners: new Set<() => void>(), instanceListeners: new Set<() => void>(),
  ready: [] as Array<{ clientId: string; channelId: string; transferIds: string[]; content: string; state: string; retryCount: number }>,
  send: vi.fn(), markFailed: vi.fn(), remove: vi.fn(), bump: vi.fn(), markSending: vi.fn(),
}));
vi.mock('./pendingMessageStore', () => ({ usePendingMessageStore: {
  getState: () => ({ bubbles: new Map([['channel', state.ready]]), listReadyForDeferredSend: () => state.ready,
    discardExpired: () => [], listFailedRetryable: () => state.ready, markFailed: state.markFailed,
    removeByClientId: state.remove, bumpRetry: state.bump, markSending: state.markSending }),
  subscribe: (listener: () => void) => { state.pendingListeners.add(listener); return () => state.pendingListeners.delete(listener); },
} }));
vi.mock('./transferStore', () => ({ useTransferStore: {
  getState: () => ({ transfers: new Map([['upload', { id: 'upload', state: 'completed', attachmentId: 'attachment' }]]) }),
  subscribe: (listener: () => void) => { state.transferListeners.add(listener); return () => state.transferListeners.delete(listener); },
} }));
vi.mock('./spaceStore', () => ({
  getChannelKind: () => 'text', getChannelOrigin: () => '', getApiForOrigin: () => ({ channels: { sendMessageReceipt: state.send } }),
  useSpaceStore: { getState: () => ({ spaceChannelIndex: new Map(), dmChannels: [] }),
    subscribe: (listener: () => void) => { state.spaceListeners.add(listener); return () => state.spaceListeners.delete(listener); } },
}));
vi.mock('./instanceStore', () => ({ useInstanceStore: {
  getState: () => ({ _autoConnectDone: true, instances: [] }),
  subscribe: (listener: () => void) => { state.instanceListeners.add(listener); return () => state.instanceListeners.delete(listener); },
} }));
vi.mock('./uiStore', () => ({ useUIStore: { getState: () => ({ addToast: vi.fn() }) } }));
let start: typeof import('./pendingMessageRehydrate').startPendingMessageOrchestrator;
let note: typeof import('./pendingMessageRehydrate').notePendingOriginReady;
const stops: Array<() => void> = [];
beforeEach(async () => {
  vi.resetModules();
  for (const set of [state.pendingListeners, state.transferListeners, state.spaceListeners, state.instanceListeners]) set.clear();
  state.ready = [{ clientId: 'pending', channelId: 'channel', transferIds: ['upload'], content: 'Keep this draft', state: 'sending', retryCount: 0 }];
  for (const fn of [state.send, state.markFailed, state.remove, state.bump, state.markSending]) fn.mockReset();
  state.send.mockResolvedValue(undefined);
  state.remove.mockImplementation(() => { state.ready = []; });
  ({ startPendingMessageOrchestrator: start, notePendingOriginReady: note } = await import('./pendingMessageRehydrate'));
});
afterEach(() => { for (const stop of stops.splice(0)) stop(); });
describe('allowed-subtree pending-message lifecycle', () => {
  it('does not send a completed upload bubble before its allowed lifecycle starts', () => {
    note(''); window.dispatchEvent(new Event('online'));
    expect(state.send).not.toHaveBeenCalled(); expect(state.ready[0]?.content).toBe('Keep this draft');
  });
  it('returns a complete idempotent teardown and does not register late lazy subscriptions', async () => {
    state.ready = [];
    const stop = start(); expect(typeof stop).toBe('function'); stops.push(stop);
    stop(); stop();
    await Promise.resolve(); await Promise.resolve();
    expect(state.pendingListeners.size + state.transferListeners.size + state.spaceListeners.size + state.instanceListeners.size).toBe(0);
    note(''); window.dispatchEvent(new Event('online')); expect(state.send).not.toHaveBeenCalled();
  });
  it('does not retry or erase queued contents when an in-flight send rejects after teardown', async () => {
    let reject: (error: Error) => void = () => {};
    state.send.mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; }));
    const stop = start(); stops.push(stop); expect(state.send).toHaveBeenCalledOnce();
    stop();
    reject(new Error('network lost'));
    await Promise.resolve(); await Promise.resolve();
    note(''); window.dispatchEvent(new Event('online'));
    expect(state.send).toHaveBeenCalledOnce(); expect(state.remove).not.toHaveBeenCalled();
    expect(state.bump).not.toHaveBeenCalled(); expect(state.markFailed).not.toHaveBeenCalled();
    expect(state.ready[0]?.content).toBe('Keep this draft');
  });
  it('supports two subscribers and a stop/restart without duplicating sends', async () => {
    state.ready = [];
    const one = start(); const two = start(); stops.push(one, two);
    expect(typeof one).toBe('function'); expect(typeof two).toBe('function');
    one(); await Promise.resolve();
    expect(state.pendingListeners.size).toBe(1);
    two();
    expect(state.pendingListeners.size).toBe(0);
    state.ready = [{ clientId: 'recovered', channelId: 'channel', transferIds: ['upload'], content: 'Recovered', state: 'sending', retryCount: 0 }];
    stops.push(start()); await Promise.resolve();
    expect(state.send).toHaveBeenCalledOnce();
    expect(state.send).toHaveBeenCalledWith('channel', expect.objectContaining({ content: 'Recovered', attachments: ['attachment'] }));
  });
});
