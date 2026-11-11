import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageWithUser, User } from '@veyvox/shared';
vi.mock('../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) } }));
const { send } = vi.hoisted(() => ({ send: vi.fn((): Promise<void> => new Promise<never>(() => {})) }));
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), api: { channels: { sendMessage: send }, dm: { sendMessage: send } } }));
import { useChatStore } from './chatStore';
import { useSpaceStore } from './spaceStore';
import { useAuthStore } from './authStore';
import { findLastOwnEditableMessage } from '../components/chat/messageEditing';
import { formatDmSidebarPreview } from '../utils/dmFormatters';
const CHANNEL = 'native-channel', DM = 'native-dm';
const me: User = { id: 'me', username: 'legacy@old.invalid', displayName: 'Jannis', avatar: null, banner: null, accentColor: null,
  avatarColor: null, bio: null, status: 'online', customStatus: null, isAdmin: false, createdAt: 1 };
const cached = () => useChatStore.getState().messages.get(CHANNEL) ?? [];
beforeEach(() => {
  useAuthStore.setState({ user: me }); useSpaceStore.getState().reset(); useChatStore.getState().clearAllMessages();
  useSpaceStore.getState().upsertChannel({ id: CHANNEL, spaceId: 's', name: 'native', type: 'text', topic: null, position: 0, categoryId: null, createdAt: 1 }, 's');
});
afterEach(() => { send.mockReset(); send.mockImplementation(() => new Promise<never>(() => {})); });
describe('native optimistic sends', () => {
  it('authors the unsent message with the exact loaded session row', () => {
    void useChatStore.getState().sendMessage(CHANNEL, 'hello'); const [temp] = cached();
    expect(temp?.id.startsWith('temp_')).toBe(true); expect(temp?.userId).toBe('me'); expect(temp?.user).toBe(me);
  });
  it('does not open an older own message while the newest is unsent', () => {
    const old: MessageWithUser = { id: '1', channelId: CHANNEL, userId: me.id, user: me, content: 'older', replyToId: null, editedAt: null, createdAt: 1 };
    useChatStore.getState().addMessage(CHANNEL, old); void useChatStore.getState().sendMessage(CHANNEL, 'newer');
    expect(findLastOwnEditableMessage(cached(), me.id)).toBeNull();
  });
  it('previews a group DM optimistic send as mine and uses its native endpoint', () => {
    useSpaceStore.getState().upsertDmChannel({ id: DM, ownerId: 'me', name: null, icon: null, createdAt: 1, members: [me, { ...me, id: 'bob', username: 'bob' }] });
    void useChatStore.getState().sendMessage(DM, 'hi all'); const dm = useSpaceStore.getState().dmChannels[0]!;
    expect(dm.lastMessage?.userId).toBe('me'); expect(formatDmSidebarPreview(dm, me.id)).toBe('hi all'); expect(send).toHaveBeenCalledWith(DM, expect.objectContaining({ content: 'hi all' }));
  });
  it('does not make an optimistic author up before account bootstrap', () => {
    useAuthStore.setState({ user: null }); void useChatStore.getState().sendMessage(CHANNEL, 'early'); expect(cached()).toEqual([]);
  });
  it('removes the optimistic send and rejects on refusal, allowing the composer to keep its draft', async () => {
    send.mockRejectedValueOnce(new Error('Offline')); await expect(useChatStore.getState().sendMessage(CHANNEL, 'hello')).rejects.toThrow('Offline'); expect(cached()).toEqual([]);
  });
  it('waits for the WS confirmation after an accepted REST send', async () => {
    send.mockResolvedValueOnce(undefined); await useChatStore.getState().sendMessage(CHANNEL, 'hello'); expect(cached().map(row => row.content)).toEqual(['hello']);
  });
});
