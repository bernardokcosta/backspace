import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpaceInviteSystemPayload } from '@veyvox/shared';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
const mocks = vi.hoisted(() => ({ preview: vi.fn(), join: vi.fn(), request: vi.fn(), navigate: vi.fn() }));
vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), api: { spaces: { invitePreview: mocks.preview } } }));
vi.mock('../../utils/inviteJoinRequest', () => ({ sendInviteJoinRequest: mocks.request }));
vi.mock('react-router-dom', async original => ({ ...await original<typeof import('react-router-dom')>(), useNavigate: () => mocks.navigate }));
import { SpaceInviteCard } from './SpaceInviteCard';
import { HttpError } from '../../api/client';
import { JoinRequestRequiredError } from '../../utils/joinErrors';
import { useSpaceStore } from '../../stores/spaceStore';
import { useAuthStore } from '../../stores/authStore';
const payload: SpaceInviteSystemPayload = { event: 'space_invite', spaceId: 'space', spaceInstanceOrigin: '', inviteCode: 'code',
  snapshot: { spaceName: 'Native Space', icon: null, avatarColor: 'mint', memberCount: 12, description: 'A place', instanceName: 'Veyvox' } };
const preview = { ...payload.snapshot, spaceId: payload.spaceId, memberCount: 99 };
const mount = (value = payload) => render(<MemoryRouter><SpaceInviteCard payload={value} senderName="Alice" /></MemoryRouter>);
beforeEach(() => {
  vi.clearAllMocks(); useSpaceStore.getState().reset(); useSpaceStore.setState({ joinByCode: mocks.join });
  mocks.preview.mockReset().mockResolvedValue(preview); mocks.join.mockReset().mockResolvedValue({ id: payload.spaceId }); mocks.request.mockReset().mockResolvedValue('sent');
});
afterEach(cleanup);
describe('native space invitation cards', () => {
  it('shows the original snapshot while its native preview is pending', () => {
    mocks.preview.mockReturnValueOnce(new Promise(() => {})); mount();
    expect(screen.getByText('Native Space')).toBeInTheDocument(); expect(screen.getByText(/12 members/)).toBeInTheDocument();
  });
  it('updates member count only after the live native preview confirms the space', async () => {
    mount(); expect(await screen.findByText(/99 members/)).toBeInTheDocument(); expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(payload.inviteCode);
  });
  it.each(['missing', 'mismatched'] as const)('revokes a %s native invite', async reason => {
    if (reason === 'missing') mocks.preview.mockRejectedValueOnce(new Error('Missing'));
    else mocks.preview.mockResolvedValueOnce({ ...preview, spaceId: 'different' });
    mount(); await screen.findByText('Invite no longer valid'); expect(screen.queryByRole('button', { name: 'Join' })).toBeNull();
  });
  it('joins by native code and navigates to the confirmed space', async () => {
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Join' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/channels/space')); expect(mocks.join).toHaveBeenCalledExactlyOnceWith('code');
  });
  it('treats already-member as successful native navigation', async () => {
    mocks.join.mockRejectedValueOnce(new HttpError(409, 'Member', undefined, 'already_member')); mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Join' })); await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/channels/space'));
  });
  it.each(['sent', 'pending'] as const)('sends the native request and displays its %s outcome', async outcome => {
    mocks.preview.mockResolvedValueOnce({ ...preview, visibility: 'request' }); mocks.request.mockResolvedValueOnce(outcome); mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Ask to join' })); await screen.findByText(outcome === 'sent' ? 'Request sent' : 'Request pending');
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith(payload.spaceId); expect(mocks.join).not.toHaveBeenCalled(); expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it('offers the native request only after the join is refused as request-required', async () => {
    mocks.join.mockRejectedValueOnce(new JoinRequestRequiredError(new HttpError(403, 'Request', undefined, 'join_request_required'), payload.spaceId));
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Join' }));
    const ask = await screen.findByRole('button', { name: 'Ask to join' }); expect(mocks.request).not.toHaveBeenCalled(); fireEvent.click(ask);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledExactlyOnceWith(payload.spaceId));
  });
  it('retries the native invite code if the space stops taking requests', async () => {
    mocks.preview.mockResolvedValueOnce({ ...preview, visibility: 'request' });
    mocks.request.mockRejectedValueOnce(new HttpError(403, 'Changed', undefined, 'space_not_requestable')); mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Ask to join' })); await waitFor(() => expect(mocks.join).toHaveBeenCalledWith(payload.inviteCode));
  });
  it('never fetches, requests or joins a foreign snapshot even when local IDs/codes collide', async () => {
    mount({ ...payload, spaceInstanceOrigin: 'https://other.example' }); await screen.findByText('Invite no longer valid');
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.join).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
  });
  it('does not navigate after a previous-session join completes', async () => {
    let finish!: (value: { id: string }) => void; mocks.join.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Join' }));
    act(() => useAuthStore.setState(s => ({ sessionRevision: s.sessionRevision + 1 })));
    await act(async () => finish({ id: payload.spaceId })); expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
