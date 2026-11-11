import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { DmChannel, User } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
vi.mock('../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));
const mocks = vi.hoisted(() => ({ search: vi.fn(), create: vi.fn() }));
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), api: {
  social: { search: mocks.search }, dm: { create: mocks.create }, uploads: { url: (file: string) => `/api/uploads/${file}` },
} }));
import { NewDmModal } from './modals/NewDmModal';
import { DmSearchBar } from './layout/DmSearchBar';
import { useAuthStore } from '../stores/authStore';
import { useSpaceStore } from '../stores/spaceStore';
import { useUIStore } from '../stores/uiStore';
const me = { id: 'me', username: 'me' } as User;
const other = { id: 'other', username: 'other@retained.invalid', displayName: null, avatar: null } as User;
const dm: DmChannel = { id: 'pair', ownerId: null, name: null, icon: null, createdAt: 1, members: [me, other] };
function Route() { return <output data-testid="route">{useLocation().pathname}</output>; }
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn(); mocks.search.mockReset(); mocks.create.mockReset(); mocks.search.mockResolvedValue([other]); mocks.create.mockResolvedValue(dm);
  useSpaceStore.getState().reset(); useAuthStore.setState({ user: me }); useUIStore.setState({ activeModal: 'newDm', modalData: {}, isMobile: false });
});
afterEach(cleanup);
describe('native DM search entrypoints', () => {
  it('creates a native pair from the new-DM modal and navigates to its local ID', async () => {
    render(<MemoryRouter><NewDmModal /><Route /></MemoryRouter>);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'other' } }); fireEvent.click(await screen.findByText(other.username));
    await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('/channels/@me/pair'));
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ userId: other.id });
  });
  it('search-bar results reuse the native pair instead of duplicating it', async () => {
    useSpaceStore.getState().upsertDmChannel(dm); render(<MemoryRouter><DmSearchBar /><Route /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button')); fireEvent.click(await screen.findByText(other.username));
    expect(screen.getByTestId('route')).toHaveTextContent('/channels/@me/pair'); expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(['modal', 'search-bar'] as const)('drops a prior-session user lookup in the %s', async surface => {
    let finish!: (users: User[]) => void; mocks.search.mockReturnValueOnce(new Promise<User[]>(resolve => { finish = resolve; }));
    render(<MemoryRouter>{surface === 'modal' ? <NewDmModal /> : <DmSearchBar />}</MemoryRouter>);
    if (surface === 'search-bar') fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'other' } }); await waitFor(() => expect(mocks.search).toHaveBeenCalledOnce());
    act(() => useAuthStore.setState(s => ({ sessionRevision: s.sessionRevision + 1 })));
    await act(async () => finish([other])); expect(screen.queryByText(other.username)).toBeNull();
  });
});
