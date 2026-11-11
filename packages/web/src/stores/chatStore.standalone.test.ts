import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageWithUser, User } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) } }));
vi.mock('../hooks/useWebSocket', () => ({ wsSend: vi.fn(() => true) }));
import { useChatStore } from './chatStore';
import { useSpaceStore } from './spaceStore';
import { useAuthStore } from './authStore';
import { api } from '../api/client';
const me: User = { id: 'me', username: 'me', displayName: null, avatar: null, banner: null, accentColor: null,
  avatarColor: null, bio: null, status: 'online', customStatus: null, isAdmin: false, createdAt: 1 };
const message = (id = '10', userId = 'me'): MessageWithUser => ({ id, channelId: 'c', userId, user: { ...me, id: userId }, content: 'same', createdAt: 1,
  replyToId: null, editedAt: null, attachments: [], embeds: [], reactions: [] });
beforeEach(() => {
  useChatStore.getState().clearAllMessages(); useSpaceStore.getState().reset(); useAuthStore.setState({ user: me, token: 'token' });
  useSpaceStore.getState().upsertChannel({ id: 'c', spaceId: 's', name: 'c', type: 'text', position: 0, categoryId: null, topic: null, createdAt: 1 }, 's');
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('native message ownership and sequential sessions', () => {
  it('a new session can load the same channel while an old GET is pending, and the old result is discarded', async () => {
    let finish!: (rows: MessageWithUser[]) => void;
    const load = vi.spyOn(api.channels, 'messages').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue([{ ...message(), content: 'new' }]);
    const old = useChatStore.getState().loadMessages('c'); useChatStore.getState().clearAllMessages();
    const next = useChatStore.getState().loadMessages('c');
    finish([{ ...message(), content: 'old' }]); await Promise.all([old, next]);
    expect(load).toHaveBeenCalledTimes(2); expect(useChatStore.getState().messages.get('c')?.map(row => row.content)).toEqual(['new']);
  });
  it('a late failed send cannot restore a reply from the previous account', async () => {
    let reject!: (error: Error) => void;
    vi.spyOn(api.channels, 'sendMessage').mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; }));
    useChatStore.getState().setReplyTo('c', message());
    const old = useChatStore.getState().sendMessage('c', 'same').catch(error => error);
    useChatStore.getState().clearAllMessages(); reject(new Error('old send')); await old;
    expect(useChatStore.getState().replyTargets.size).toBe(0); expect(useChatStore.getState().messages.size).toBe(0);
  });
  it.each(['addMessage', 'addRealtimeMessage'] as const)('%s never consumes my optimistic message on another user\'s identical content', action => {
    useChatStore.getState().addMessage('c', message('temp_native'));
    useChatStore.getState()[action]('c', message('11', 'bob'));
    expect(useChatStore.getState().messages.get('c')?.map(row => row.id)).toEqual(['temp_native', '11']);
    useChatStore.getState()[action]('c', message('12'));
    expect(useChatStore.getState().messages.get('c')?.map(row => row.id)).toEqual(['11', '12']);
  });
  it('does not discard a distinct native ID because untyped obsolete sourceMessageId matches another', () => {
    useChatStore.getState().addRealtimeMessage('c', message('10'));
    const extra = { ...message('11', 'bob'), sourceMessageId: '10' }; useChatStore.getState().addRealtimeMessage('c', extra);
    expect(useChatStore.getState().messages.get('c')?.map(row => row.id)).toEqual(['10', '11']);
    expect(useChatStore.getState()).not.toHaveProperty('rekeyChannelState');
  });
  it('a typing timeout from the previous session cannot clear an equal-id next-session typist', () => {
    vi.useFakeTimers(); useChatStore.getState().setTyping('c', 'bob', 'old'); vi.advanceTimersByTime(2000);
    useChatStore.getState().clearAllMessages(); useChatStore.getState().setTyping('c', 'bob', 'new'); vi.advanceTimersByTime(3000);
    expect(useChatStore.getState().getTypingUsers('c').map(row => row.username)).toEqual(['new']);
  });
});
