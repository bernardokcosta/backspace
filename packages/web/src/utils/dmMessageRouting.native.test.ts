import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DmChannel, DmMessageWithUser, User } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) } }));
vi.mock('../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));
import { applyIncomingDmMessage } from './dmMessageRouting';
import { useAuthStore } from '../stores/authStore';
import { useSpaceStore } from '../stores/spaceStore';
import { useChatStore } from '../stores/chatStore';
import { api } from '../api/client';
const user = (id: string): User => ({ id, username: id, displayName: null, avatar: null, banner: null, accentColor: null,
  avatarColor: null, bio: null, status: 'online', customStatus: null, isAdmin: false, createdAt: 1 });
const dm = (id: string): DmChannel => ({ id, ownerId: null, name: null, icon: null, createdAt: 1, members: [user('me'), user(id)] });
const message = (id: string, dmChannelId: string, author = 'me'): DmMessageWithUser => ({ id, dmChannelId, userId: author, user: user(author),
  content: 'same', replyToId: null, editedAt: null, createdAt: 2, attachments: [], embeds: [], reactions: [] });
beforeEach(() => { useAuthStore.setState({ user: user('me') }); useSpaceStore.getState().reset(); useChatStore.getState().clearAllMessages(); });
afterEach(() => vi.restoreAllMocks());
describe('native DM event placement', () => {
  it('routes by the local conversation id, never the shared own author', async () => {
    useSpaceStore.getState().upsertDmChannel(dm('bob')); useSpaceStore.getState().upsertDmChannel(dm('carol'));
    await applyIncomingDmMessage(message('20', 'carol'), () => true);
    expect(useChatStore.getState().messages.get('bob')).toBeUndefined(); expect(useChatStore.getState().messages.get('carol')?.[0]?.id).toBe('20');
    expect(useSpaceStore.getState().dmChannels.find(row => row.id === 'carol')?.lastMessage?.id).toBe('20');
    expect(useChatStore.getState().unreadChannels.size).toBe(0);
  });
  it('marks only another user\'s message in an unopened native DM unread', async () => {
    useSpaceStore.getState().upsertDmChannel(dm('bob')); await applyIncomingDmMessage(message('20', 'bob', 'bob'), () => true);
    expect([...useChatStore.getState().unreadChannels]).toEqual(['bob']);
  });
  it('learns an unknown native DM from the current list instead of inventing/guessing one', async () => {
    const list = vi.spyOn(api.dm, 'list').mockResolvedValue([dm('bob')]); await applyIncomingDmMessage(message('20', 'bob', 'bob'), () => true);
    expect(list).toHaveBeenCalledTimes(1); expect(useSpaceStore.getState().dmChannels[0]?.id).toBe('bob'); expect(useChatStore.getState().messages.get('bob')?.[0]?.id).toBe('20');
  });
  it('discards an old socket\'s delayed DM list result', async () => {
    let finish!: (rows: DmChannel[]) => void, current = true;
    vi.spyOn(api.dm, 'list').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = applyIncomingDmMessage(message('20', 'bob'), () => current); current = false; useSpaceStore.getState().reset();
    finish([dm('bob')]); await old; expect(useChatStore.getState().messages.size).toBe(0);
  });
  it('does not guess another conversation when the current native list omits the channel', async () => {
    vi.spyOn(api.dm, 'list').mockResolvedValue([dm('carol')]);
    await applyIncomingDmMessage(message('20', 'bob', 'bob'), () => true);
    expect(useChatStore.getState().messages.size).toBe(0); expect(useChatStore.getState().unreadChannels.size).toBe(0);
    expect(useSpaceStore.getState().dmChannels[0]?.lastMessage).toBeUndefined();
  });
  it('leaves the DM and unread state untouched when the native list request fails', async () => {
    vi.spyOn(api.dm, 'list').mockRejectedValueOnce(new Error('List unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await applyIncomingDmMessage(message('20', 'bob', 'bob'), () => true);
    expect(useChatStore.getState().messages.size).toBe(0); expect(useSpaceStore.getState().dmChannels).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});
