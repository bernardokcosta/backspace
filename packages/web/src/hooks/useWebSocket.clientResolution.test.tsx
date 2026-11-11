import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Activity, MemberWithUser, User } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { useWebSocket } from './useWebSocket';
import { useAuthStore } from '../stores/authStore';
import { useSpaceStore } from '../stores/spaceStore';
import { activitiesFor, useActivityStore } from '../stores/activityStore';
import { useSocialStore } from '../stores/socialStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useNotificationSettingsStore } from '../stores/notificationSettingsStore';
import { junoUser } from '../components/games/junoTestFixtures';
import { installSocketHarness, TestWebSocket } from '../test/socketHarness';
const kai = junoUser('kai'), zed = junoUser('zed');
const member = (spaceId: string, user: User): MemberWithUser => ({ spaceId, userId: user.id, nickname: null, joinedAt: 1, user, roles: [] });
const playing: Activity[] = [{ type: 'playing', name: 'Factorio' }];
beforeEach(() => {
  installSocketHarness(); useAuthStore.setState({ token: 'native-token', user: junoUser('me') });
  useSpaceStore.getState().reset(); useSpaceStore.setState({ currentSpaceId: 'sp', members: [member('sp', kai)] }); useActivityStore.getState().reset();
  for (const name of ['loadFriends', 'loadRequests'] as const) vi.spyOn(useSocialStore.getState(), name).mockResolvedValue(undefined);
  for (const name of ['fetchStreamingLimits', 'fetchGifEnabled'] as const) vi.spyOn(useSettingsStore.getState(), name).mockResolvedValue(undefined);
  vi.spyOn(useNotificationSettingsStore.getState(), 'load').mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); useAuthStore.setState({ token: null }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function open(): TestWebSocket { renderHook(() => useWebSocket()); const ws = TestWebSocket.all[0]!; act(() => ws.open()); return ws; }
const ready = () => ({ type: 'ready', user: junoUser('me'), spaces: [], dmChannels: [], folders: [], readStates: [], activeCalls: [], userActivities: {} });
describe('native roster resolution', () => {
  it('adds a member who joins the loaded space', () => {
    open().deliver({ type: 'member_joined', spaceId: 'sp', member: member('sp', zed) });
    expect(useSpaceStore.getState().members.map(row => row.userId)).toEqual(['kai', 'zed']);
  });
  it('keeps the loaded roster unchanged when someone joins another space', () => {
    open().deliver({ type: 'member_joined', spaceId: 'other', member: member('other', zed) });
    expect(useSpaceStore.getState().members.map(row => row.userId)).toEqual(['kai']);
  });
  it('keeps the loaded roster unchanged when someone leaves another space', () => {
    open().deliver({ type: 'member_left', spaceId: 'other', userId: kai.id });
    expect(useSpaceStore.getState().members.map(row => row.userId)).toEqual(['kai']);
  });
  it('removes a member who leaves the loaded space', () => {
    open().deliver({ type: 'member_left', spaceId: 'sp', userId: kai.id }); expect(useSpaceStore.getState().members).toEqual([]);
  });
  it('updates the exact native member presence and its cached profile', () => {
    useSpaceStore.getState().upsertUserView(kai); open().deliver({ type: 'presence_update', userId: kai.id, status: 'dnd' });
    expect(useSpaceStore.getState().members[0]?.user.status).toBe('dnd'); expect(useSpaceStore.getState().userViews.get(kai.id)?.user.status).toBe('dnd');
  });
  it('does not merge presence for a different native ID sharing a retained handle', () => {
    useSpaceStore.getState().upsertUserView(kai); open().deliver({ type: 'presence_update', userId: 'different-kai', status: 'offline' });
    expect(useSpaceStore.getState().members[0]?.user).toEqual(kai); expect(useSpaceStore.getState().userViews.get(kai.id)?.user).toEqual(kai);
  });
  it('ignores an earlier session roster delivery even if the next session has equal IDs', () => {
    const old = open(); act(() => useAuthStore.setState(state => ({ sessionRevision: state.sessionRevision + 1 })));
    old.deliver({ type: 'member_left', spaceId: 'sp', userId: kai.id }); expect(useSpaceStore.getState().members.map(row => row.userId)).toEqual(['kai']);
  });
});
describe('native activity snapshots', () => {
  it('replaces all activities on ready, including friends without an open space', () => {
    const ws = open(); ws.deliver({ type: 'presence_update', userId: zed.id, status: 'online', activities: playing });
    expect(activitiesFor(useActivityStore.getState().userActivities, zed.id)).toEqual(playing);
    ws.deliver(ready()); expect(activitiesFor(useActivityStore.getState().userActivities, zed.id)).toEqual([]);
  });
  it('clears only the named native user when a live report has no activities', () => {
    const ws = open(); for (const userId of [kai.id, zed.id]) ws.deliver({ type: 'presence_update', userId, status: 'online', activities: playing });
    ws.deliver({ type: 'presence_update', userId: zed.id, status: 'online', activities: [] });
    expect(activitiesFor(useActivityStore.getState().userActivities, zed.id)).toEqual([]);
    expect(activitiesFor(useActivityStore.getState().userActivities, kai.id)).toEqual(playing);
  });
});
