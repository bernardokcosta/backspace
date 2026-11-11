import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Channel, DmChannel, MemberWithUser, User } from '@veyvox/shared';
// The store graph reaches the audio engine, which needs Web Audio at import.
vi.mock('../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }),
  },
}));

import { useAuthStore } from '../stores/authStore';
import { useSpaceStore } from '../stores/spaceStore';
import { useChannelMentionCandidates, useChannelUser, useChannelUserResolver } from './channelUser';

function makeUser(id: string, username: string, displayName: string | null): User {
  return {
    id, username, displayName, avatar: null, banner: null, accentColor: null, avatarColor: null,
    bio: null, status: 'online', customStatus: null, isAdmin: false, createdAt: 1,
  };
}

function member(spaceId: string, user: User): MemberWithUser {
  return { spaceId, userId: user.id, nickname: null, joinedAt: 1, user, roles: [] };
}

function channel(id: string, spaceId: string): Channel {
  return { id, spaceId, name: id, type: 'text', topic: null, position: 0, categoryId: null, createdAt: 0 };
}

const me = makeUser('me', 'alice', 'Alice');
const kai = makeUser('kai', 'kai', 'Kai');

afterEach(() => {
  cleanup();
  useAuthStore.setState({ user: null });
  useSpaceStore.getState().reset();
});

// Native lookup maps replace references; hooks must observe the new entries.
describe('channelUser hooks and native lookup map updates', () => {
  it('resolves a member once a new channel of the loaded space is upserted', () => {
    useSpaceStore.setState({ currentSpaceId: 'space-1', members: [member('space-1', kai)] });
    const { result } = renderHook(() => useChannelUser('chan-new', kai.id));
    expect(result.current).toBeNull();

    act(() => useSpaceStore.getState().upsertChannel(channel('chan-new', 'space-1'), 'space-1'));

    expect(result.current?.userId).toBe(kai.id);
  });

  it("lists the new channel's space roster once the channel is upserted", () => {
    useSpaceStore.setState({ currentSpaceId: 'space-1', members: [member('space-1', kai)] });
    const { result } = renderHook(() => useChannelMentionCandidates('chan-new'));
    expect(result.current).toEqual([]);

    act(() => useSpaceStore.getState().upsertChannel(channel('chan-new', 'space-1'), 'space-1'));

    expect(result.current.map((c) => c.userId)).toEqual([kai.id]);
  });

});

describe('useChannelUserResolver', () => {
  it("answers for the channel's own people, as useChannelUser does, and nobody else", () => {
    const zed = makeUser('zed', 'zed', null);
    useSpaceStore.setState({
      channelToSpaceMap: new Map([['chan-1', 'space-1'], ['chan-2', 'space-2']]),
      members: [member('space-1', kai)],
    });
    const { result } = renderHook(() => ({
      resolve: useChannelUserResolver('chan-1'),
      single: useChannelUser('chan-1', kai.id),
      other: useChannelUserResolver('chan-2'),
    }));
    expect(result.current.resolve(kai.id)).toEqual(result.current.single);
    expect(result.current.resolve(zed.id)).toBeNull();
    // The roster loaded is space-1's; chan-2's people are not known.
    expect(result.current.other(kai.id)).toBeNull();
  });

  it('resolves native DM IDs including the signed-in user, never a same-handle ID', () => {
    const otherKai = makeUser('other-kai', 'kai', 'Kai');
    const nativeDm = { id: 'dm', ownerId: null, name: null, icon: null, createdAt: 1, members: [me, otherKai], lastMessage: null } as DmChannel;
    useAuthStore.setState({ user: me });
    useSpaceStore.setState({ dmChannels: [nativeDm], members: [member('space-1', kai)] });
    const { result } = renderHook(() => useChannelUserResolver(nativeDm.id));
    expect(result.current(otherKai.id)).not.toHaveProperty('origin');
    expect(result.current(me.id)?.user.displayName).toBe('Alice');
    expect(result.current(kai.id)).toBeNull();
  });

  it('gives a new lookup with the better view once the user-view cache learns one', () => {
    const stub = makeUser('native', '1234567890123456789@retained.test', null);
    const dm = { id: 'dm-1', ownerId: null, createdAt: 1, members: [me, stub], lastMessage: null } as unknown as DmChannel;
    useSpaceStore.setState({ dmChannels: [dm] });
    const { result } = renderHook(() => useChannelUserResolver(dm.id));
    expect(result.current(stub.id)?.user.displayName).toBeNull();

    const fresh = { ...stub, displayName: 'Quinn' };
    act(() => useSpaceStore.getState().upsertUserView(fresh));

    expect(result.current(stub.id)?.user.displayName).toBe('Quinn');
    expect(result.current(stub.id)?.userId).toBe(stub.id);
  });
});
