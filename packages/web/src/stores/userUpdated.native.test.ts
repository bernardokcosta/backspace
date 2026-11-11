import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoverUser, Friend, FriendRequest, MemberWithUser, MessageWithUser, User } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { useSpaceStore } from './spaceStore';
import { useSocialStore } from './socialStore';
import { useChatStore } from './chatStore';
import { useDiscoverStore } from './discoverStore';
import { junoUser } from '../components/games/junoTestFixtures';
import { wireDm } from '../test/dmWireShape';
const first = { ...junoUser('first'), username: 'same@retained.test' };
const second = { ...junoUser('second'), username: first.username };
const changed = { ...second, displayName: 'Updated native name', avatar: 'native.png' };
const member = (user: User): MemberWithUser => ({ spaceId: 'space', userId: user.id, nickname: null, joinedAt: 1, user, roles: [] });
const friend = (user: User): Friend => ({ ...user, addedAt: 1 });
const request = (user: User): FriendRequest => ({ id: user.id, fromId: user.id, toId: 'me', status: 'pending', createdAt: 1, user });
const card = (user: User): DiscoverUser => ({ ...user, mutualFriendCount: 0, mutualSpaceCount: 0, relationship: 'none' });
const message = (user: User): MessageWithUser => ({ id: user.id, channelId: 'channel', userId: user.id, user, content: 'native', replyToId: null,
  editedAt: null, createdAt: 1, attachments: [], embeds: [], reactions: [] });
beforeEach(() => { useSpaceStore.getState().reset(); useSpaceStore.setState({ members: [member(first), member(second)] }); });
describe('native profile and tombstone propagation', () => {
  it('patches only exact native roster IDs, never a same-handle account', () => {
    useSpaceStore.getState().updateUserEverywhere(changed);
    expect(useSpaceStore.getState().members.map(row => row.user)).toEqual([first, changed]);
  });
  it('patches the target across native DM members, preserving other accounts', () => {
    useSpaceStore.getState().upsertDmChannel(wireDm({ id: 'pair', createdAt: 1, members: [first, second] }));
    useSpaceStore.getState().updateUserEverywhere(changed);
    expect(useSpaceStore.getState().dmChannels[0]?.members).toEqual([first, changed]);
  });
  it('updates only the native friendship row and keeps its friendship timestamp', () => {
    useSocialStore.setState({ friends: [friend(first), friend(second)] }); useSocialStore.getState().updateFriendProfile(changed);
    expect(useSocialStore.getState().friends).toEqual([friend(first), friend(changed)]);
  });
  it('patches native message authors across channels without changing their account IDs', () => {
    useChatStore.setState({ messages: new Map([['channel', [message(first), message(second)]]]) });
    useChatStore.getState().updateUserInMessages(changed);
    expect(useChatStore.getState().messages.get('channel')?.map(row => row.user)).toEqual([first, changed]);
  });
  it('removes only the deleted native account from friends, requests, discovery and typing', () => {
    useSocialStore.setState({ friends: [friend(first), friend(second)], requests: [request(first), request(second)] });
    useDiscoverStore.setState({ users: [card(first), card(second)], total: 2 });
    useChatStore.setState({ typingUsers: new Map([['channel', [first, second].map(user => ({ userId: user.id, username: user.username, timestamp: 1 }))]]) });
    useSocialStore.getState().removeDeletedUser(second.id); useDiscoverStore.getState().removeDeletedUser(second.id); useChatStore.getState().clearTypingForDeletedUser(second.id);
    expect(useSocialStore.getState().friends).toEqual([friend(first)]); expect(useSocialStore.getState().requests).toEqual([request(first)]);
    expect(useDiscoverStore.getState().users).toEqual([card(first)]); expect(useDiscoverStore.getState().total).toBe(1);
    expect(useChatStore.getState().typingUsers.get('channel')?.map(row => row.userId)).toEqual([first.id]);
  });
});
