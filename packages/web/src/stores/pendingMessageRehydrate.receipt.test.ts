import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) } }));
vi.mock('./instanceStore', () => ({ useInstanceStore: { getState: () => ({ _autoConnectDone: true, instances: [] }), subscribe: () => () => {} } }));
import { usePendingMessageStore } from './pendingMessageStore';
import { useTransferStore } from './transferStore';
import { useSpaceStore } from './spaceStore';
import { startPendingMessageOrchestrator } from './pendingMessageRehydrate';
let stop: (() => void) | undefined;
afterEach(() => { stop?.(); vi.restoreAllMocks(); usePendingMessageStore.setState({ bubbles: new Map() }); });
describe('confirmed pending delivery with the real API/store/orchestrator', () => {
  it('keeps a rate-limited attachment message for explicit retry, not an online replay', async () => {
    useTransferStore.setState({ transfers: new Map() });
    usePendingMessageStore.setState({ bubbles: new Map() }); useSpaceStore.getState().reset();
    const channel: Channel = { id: 'limited-channel', spaceId: 'space', name: 'limited', type: 'text', topic: null, position: 0, categoryId: null, createdAt: 1, myPermissions: '1' };
    useSpaceStore.getState().upsertChannel(channel, 'space', '');
    const transfer = useTransferStore.getState().createTransfer({ type: 'upload', file: { name: 'draft', size: 1, mimetype: 'text/plain' }, tray: false });
    useTransferStore.getState().setAttachmentRef(transfer, 'attachment', 'draft'); useTransferStore.getState().setState_(transfer, 'completed');
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ code: 'rate_limited', retryAfter: 2 }), { status: 429 }));
    usePendingMessageStore.getState().append({ clientId: 'limited', channelId: channel.id, content: 'Keep this draft', replyToId: 'reply-target',
      transferIds: [transfer], createdAtLocal: Date.now(), tusExpiresAt: Date.now() + 60_000, state: 'sending', retryCount: 0 });
    stop = startPendingMessageOrchestrator();
    await vi.waitFor(() => expect(usePendingMessageStore.getState().bubbles.get(channel.id)?.[0]?.state).toBe('failed'));
    window.dispatchEvent(new Event('online'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetcher).toHaveBeenCalledOnce();
    expect(usePendingMessageStore.getState().bubbles.get(channel.id)?.[0]).toMatchObject({ content: 'Keep this draft', replyToId: 'reply-target', transferIds: [transfer] });
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 201 }));
    usePendingMessageStore.getState().markSending('limited');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });

  it('does not resend an HTTP-confirmed message when its body completes after teardown', async () => {
    useTransferStore.setState({ transfers: new Map() });
    usePendingMessageStore.setState({ bubbles: new Map() }); useSpaceStore.getState().reset();
    const channel: Channel = { id: 'receipt-channel', spaceId: 'space', name: 'receipt', type: 'text', topic: null, position: 0, categoryId: null, createdAt: 1, myPermissions: '1' };
    useSpaceStore.getState().upsertChannel(channel, 'space', '');
    const transfer = useTransferStore.getState().createTransfer({ type: 'upload', file: { name: 'draft', size: 1, mimetype: 'text/plain' }, tray: false });
    useTransferStore.getState().setAttachmentRef(transfer, 'attachment', 'draft'); useTransferStore.getState().setState_(transfer, 'completed');
    let finish: (body: unknown) => void = () => {};
    const body = new Promise((resolve) => { finish = resolve; });
    const confirmed = new Response('{}', { status: 200 });
    vi.spyOn(confirmed, 'json').mockImplementation(() => body);
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(confirmed);
    usePendingMessageStore.getState().append({ clientId: 'receipt', channelId: channel.id, content: 'Deliver once', replyToId: null,
      transferIds: [transfer], createdAtLocal: Date.now(), tusExpiresAt: Date.now() + 60_000, state: 'sending', retryCount: 0 });
    stop = startPendingMessageOrchestrator();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    stop();
    finish({ id: 'delivered' }); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(usePendingMessageStore.getState().bubbles.get(channel.id) ?? []).toEqual([]);
    stop = startPendingMessageOrchestrator();
    await new Promise((resolve) => setTimeout(resolve, 0)); expect(fetcher).toHaveBeenCalledOnce();
  });
});
