import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { api } from '../api/client';
import { useAuthStore } from './authStore';
import { useSpaceStore } from './spaceStore';
import { useTransferStore } from './transferStore';
import { usePendingMessageStore, type PendingBubble } from './pendingMessageStore';
import { notePendingReady, startPendingMessageOrchestrator } from './pendingMessageRehydrate';
import { junoUser } from '../components/games/junoTestFixtures';
const channel: Channel = { id: 'same-channel', spaceId: 'space', name: 'native', topic: null, type: 'text', categoryId: null, position: 0, createdAt: 1 };
const bubble = (changes: Partial<PendingBubble> = {}): PendingBubble => ({ clientId: 'same-client', channelId: channel.id, content: 'Private pending text',
  replyToId: null, transferIds: [], createdAtLocal: Date.now(), state: 'sending', tusExpiresAt: Date.now() + 60_000, retryCount: 0, ...changes });
let stop: (() => void) | undefined;
beforeEach(() => {
  usePendingMessageStore.setState({ bubbles: new Map() }); useTransferStore.setState({ transfers: new Map() });
  useAuthStore.getState().initSession('jwt', junoUser('same-user')); useSpaceStore.getState().upsertChannel(channel, 'space');
  vi.spyOn(api.channels, 'sendMessageReceipt').mockResolvedValue(undefined);
});
afterEach(() => { stop?.(); stop = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
describe('current-server/account pending ownership', () => {
  it('captures native ownership for new pending work', () => {
    usePendingMessageStore.getState().append(bubble());
    expect(usePendingMessageStore.getState().listForChannel(channel.id)[0]).toMatchObject({ origin: window.location.origin, uploaderUserId: 'same-user' });
  });
  it.each(['account', 'server'] as const)('preserves but never displays, sends, matches or expires an earlier %s bubble', async mismatch => {
    usePendingMessageStore.getState().append(bubble({ tusExpiresAt: 1 }));
    if (mismatch === 'account') useAuthStore.getState().initSession('next', junoUser('other-user'));
    else vi.stubGlobal('window', { location: { origin: 'https://next.invalid' },
      addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window) });
    useSpaceStore.getState().upsertChannel(channel, 'space');
    stop = startPendingMessageOrchestrator(); notePendingReady(); await settle();
    expect(api.channels.sendMessageReceipt).not.toHaveBeenCalled();
    expect(usePendingMessageStore.getState().listForChannel(channel.id)).toEqual([]);
    expect(usePendingMessageStore.getState().matchAndRemove(channel.id, 'Private pending text', [])).toBeNull();
    expect(usePendingMessageStore.getState().bubbles.get(channel.id)).toHaveLength(1);
  });
  it('does not infer the owner of an unscoped legacy text-only bubble from a new login', async () => {
    usePendingMessageStore.setState({ bubbles: new Map([[channel.id, [bubble()]]]) });
    stop = startPendingMessageOrchestrator(); notePendingReady(); await settle();
    expect(api.channels.sendMessageReceipt).not.toHaveBeenCalled(); expect(usePendingMessageStore.getState().bubbles.get(channel.id)).toHaveLength(1);
  });
  it('recovers a legacy attachment bubble only from all its retained native transfer owners', async () => {
    const id = useTransferStore.getState().createTransfer({ type: 'upload', tray: false, file: { name: 'native', size: 1, mimetype: 'text/plain' } });
    useTransferStore.getState().setAttachmentRef(id, 'attachment', 'native'); useTransferStore.getState().setState_(id, 'completed');
    usePendingMessageStore.setState({ bubbles: new Map([[channel.id, [bubble({ transferIds: [id] })]]]) });
    stop = startPendingMessageOrchestrator(); await settle();
    expect(api.channels.sendMessageReceipt).toHaveBeenCalledExactlyOnceWith(channel.id, expect.objectContaining({ attachments: ['attachment'] }));
  });
  it.each(['resolve', 'reject'] as const)('an old %s response cannot mutate a replacement pending bubble with colliding IDs', async outcome => {
    let finish!: () => void;
    vi.mocked(api.channels.sendMessageReceipt).mockReturnValueOnce(new Promise<void>((resolve, reject) => { finish = () => outcome === 'resolve' ? resolve() : reject(new Error('Old network failure')); }));
    usePendingMessageStore.getState().append(bubble()); stop = startPendingMessageOrchestrator();
    expect(api.channels.sendMessageReceipt).toHaveBeenCalledOnce();
    useAuthStore.getState().initSession('next', junoUser('next-user'));
    usePendingMessageStore.getState().append(bubble({ content: 'Replacement draft', state: 'failed' }));
    finish(); await settle();
    expect(usePendingMessageStore.getState().listForChannel(channel.id)).toEqual([expect.objectContaining({ content: 'Replacement draft', state: 'failed', retryCount: 0 })]);
    expect(api.channels.sendMessageReceipt).toHaveBeenCalledOnce();
  });
});
