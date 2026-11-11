import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Activity } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ playSound: vi.fn(async () => null) }) } }));
import { useWebSocket } from './useWebSocket';
import { useAuthStore } from '../stores/authStore';
import { useSocialStore } from '../stores/socialStore';
import { useSpaceStore } from '../stores/spaceStore';
import { useActivityStore } from '../stores/activityStore';
import { useUIStore } from '../stores/uiStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useNotificationSettingsStore } from '../stores/notificationSettingsStore';
import { ActivityPanel } from '../components/layout/ActivityPanel';
import { MemberSidebar } from '../components/layout/MemberSidebar';
import { FriendsPage } from '../components/chat/FriendsPage';
import { junoUser } from '../components/games/junoTestFixtures';
import { installSocketHarness, TestWebSocket } from '../test/socketHarness';
const bob = { ...junoUser('bob'), username: 'bob@retained.test', displayName: 'Bob', status: 'offline' as const };
const playing: Activity[] = [{ type: 'playing', name: 'Factorio' }];
beforeEach(() => {
  installSocketHarness(); useAuthStore.setState({ token: 'native-token', user: junoUser('viewer') });
  useActivityStore.getState().reset(); useSpaceStore.getState().reset();
  useSocialStore.setState({ friends: [{ ...bob, addedAt: 1 }], requests: [] });
  for (const name of ['loadFriends', 'loadRequests'] as const) vi.spyOn(useSocialStore.getState(), name).mockResolvedValue(undefined);
  for (const name of ['fetchStreamingLimits', 'fetchGifEnabled'] as const) vi.spyOn(useSettingsStore.getState(), name).mockResolvedValue(undefined);
  vi.spyOn(useNotificationSettingsStore.getState(), 'load').mockResolvedValue(undefined);
  useUIStore.setState({ isMobile: false, memberListOpen: true });
});
afterEach(() => { cleanup(); useAuthStore.setState({ token: null }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function open(): TestWebSocket { renderHook(() => useWebSocket()); const ws = TestWebSocket.all[0]!; act(() => ws.open()); return ws; }
const presence = (ws: TestWebSocket, activities = playing, userId = bob.id) => act(() => ws.deliver({ type: 'presence_update', userId, status: 'online', activities }));
describe('native friend activity across retained views', () => {
  it('shows the native friend activity delivered under its exact ID', () => {
    const ws = open(); render(<ActivityPanel />); presence(ws);
    expect(useSocialStore.getState().friends[0]?.status).toBe('online'); expect(screen.getByText('Factorio')).toBeInTheDocument();
  });
  it('updates and clears both the native roster and friend activity panel', async () => {
    useSpaceStore.setState({ spaces: [{ id: 'sp', name: 'Native', icon: null, banner: null, avatarColor: null, ownerId: 'owner', ownerTitle: null,
      inviteCode: null, visibility: 'private', description: null, createdAt: 1 }], currentSpaceId: 'sp',
      members: [{ spaceId: 'sp', userId: bob.id, nickname: null, joinedAt: 1, user: bob, roles: [] }] });
    const ws = open(); const friends = render(<ActivityPanel />).container;
    const members = render(<MemoryRouter><MemberSidebar /></MemoryRouter>).container; presence(ws);
    expect(within(friends).getByText('Factorio')).toBeInTheDocument(); expect(within(members).getByText('Factorio')).toBeInTheDocument();
    presence(ws, []); await waitFor(() => { expect(within(friends).queryByText('Factorio')).toBeNull(); expect(within(members).queryByText('Factorio')).toBeNull(); });
  });
  it('does not attribute another native ID activity to a friend with an equal username', () => {
    const ws = open(); render(<ActivityPanel />); presence(ws, playing, 'other-bob');
    expect(screen.queryByText('Factorio')).toBeNull(); expect(useSocialStore.getState().friends[0]?.status).toBe('offline');
  });
  it('shows activities from the current ready snapshot without identity projections', () => {
    const ws = open(); useSocialStore.setState({ friends: [{ ...bob, status: 'online', addedAt: 1 }] }); render(<ActivityPanel />);
    act(() => ws.deliver({ type: 'ready', user: junoUser('viewer'), spaces: [], dmChannels: [], folders: [], readStates: [], activeCalls: [], userActivities: { [bob.id]: playing } }));
    expect(screen.getByText('Factorio')).toBeInTheDocument();
  });
  it('shows the same native friend in the mobile activity tab', async () => {
    useUIStore.setState({ isMobile: true }); const ws = open(); render(<MemoryRouter><FriendsPage mobile /></MemoryRouter>); presence(ws);
    await userEvent.click(screen.getByRole('button', { name: /activity/i })); expect(screen.getByText('Factorio')).toBeInTheDocument();
  });
});
