import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Stub AudioManager to avoid AudioWorkletNode reference error in jsdom.
// Reached transitively via spaceStore → chatStore → useWebSocket → voiceStore.
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

import { JoinSpaceModal } from './JoinSpace';
import { useUIStore } from '../../stores/uiStore';
import { useSpaceStore, NotConnectedError } from '../../stores/spaceStore';
import { useInstanceStore, RemoteLoginRequiredError } from '../../stores/instanceStore';
import { HttpError } from '../../api/client';
import { JoinRequestRequiredError } from '../../utils/joinErrors';
import { sendInviteJoinRequest } from '../../utils/inviteJoinRequest';
vi.mock('../../utils/inviteJoinRequest', () => ({ sendInviteJoinRequest: vi.fn() }));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.mocked(sendInviteJoinRequest).mockReset().mockResolvedValue('sent');
  mockNavigate.mockClear();
  useUIStore.setState({ activeModal: null });
  useSpaceStore.setState({
    spaces: [],
    currentSpaceId: null,
  });
  useUIStore.setState({ isMobile: false });
});
afterEach(() => { vi.unstubAllGlobals(); });

function renderModal() {
  return render(
    <MemoryRouter>
      <JoinSpaceModal />
    </MemoryRouter>
  );
}

describe('JoinSpaceModal', () => {
  it('connects to the explicit invitation origin with the existing password flow', async () => {
    const user = userEvent.setup();
    const origin = 'https://orbit.example';
    const join = vi.fn().mockRejectedValueOnce(new NotConnectedError(origin)).mockResolvedValueOnce({ id: 'remote-space' });
    const connect = vi.fn().mockResolvedValue(undefined);
    useSpaceStore.setState({ joinByCode: join });
    useInstanceStore.setState({ connectToRemote: connect });
    useUIStore.setState({ activeModal: 'joinSpace' }); renderModal();
    await user.type(screen.getByPlaceholderText('e.g. abc123 or https://instance.com/join/abc123'), `${origin}/join/code`);
    await user.click(screen.getByRole('button', { name: 'Join Space' }));
    await user.type(await screen.findByPlaceholderText('Your account password'), 'fixture-password');
    await user.click(screen.getByRole('button', { name: 'Connect & Join' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/channels/remote-space'));
    expect(connect).toHaveBeenCalledWith(origin, 'fixture-password', undefined);
    expect(join).toHaveBeenLastCalledWith('code', origin);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retains explicit remote-account fallback without any directory lookup', async () => {
    const user = userEvent.setup();
    const origin = 'https://orbit.example';
    const join = vi.fn().mockRejectedValueOnce(new NotConnectedError(origin)).mockResolvedValueOnce({ id: 'remote-space' });
    const login = vi.fn().mockResolvedValue(undefined);
    useSpaceStore.setState({ joinByCode: join });
    useInstanceStore.setState({
      connectToRemote: vi.fn().mockRejectedValue(new RemoteLoginRequiredError('mira', 'credential-refused')),
      loginToRemote: login,
    });
    useUIStore.setState({ activeModal: 'joinSpace' }); renderModal();
    await user.type(screen.getByPlaceholderText('e.g. abc123 or https://instance.com/join/abc123'), `${origin}/join/code`);
    await user.click(screen.getByRole('button', { name: 'Join Space' }));
    await user.type(await screen.findByPlaceholderText('Your account password'), 'home-password');
    await user.click(screen.getByRole('button', { name: 'Connect & Join' }));
    await user.type(await screen.findByPlaceholderText('Password on the remote instance'), 'remote-password');
    await user.click(screen.getByRole('button', { name: 'Login & Join' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/channels/remote-space'));
    expect(login).toHaveBeenCalledWith(origin, 'mira', 'remote-password');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not render when activeModal is not "joinSpace"', () => {
    useUIStore.setState({ activeModal: null });
    renderModal();
    expect(screen.queryByText('Join a Space')).not.toBeInTheDocument();
  });

  it('renders the form when opened', () => {
    useUIStore.setState({ activeModal: 'joinSpace' });
    renderModal();
    expect(screen.getByText('Join a Space')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('e.g. abc123 or https://instance.com/join/abc123')
    ).toBeInTheDocument();
    expect(screen.getByText('Join Space')).toBeInTheDocument();
  });

  it('disables the Join Space button while the input is empty', () => {
    useUIStore.setState({ activeModal: 'joinSpace' });
    renderModal();

    // The submit button is the validation gate in this UI — there is no
    // click-to-show-error path. parseInviteInput's 'Invite code is required'
    // branch is defensive only and unreachable from the rendered form.
    expect(screen.getByText('Join Space')).toBeDisabled();
  });

  it('calls joinByCode with the entered invite code and navigates on success', async () => {
    const user = userEvent.setup();
    const mockJoinByCode = vi.fn().mockResolvedValue({ id: 'new-space-id', name: 'Test Space' });
    useUIStore.setState({ activeModal: 'joinSpace' });
    useSpaceStore.setState({ joinByCode: mockJoinByCode });

    renderModal();

    // Type invite code
    const input = screen.getByPlaceholderText('e.g. abc123 or https://instance.com/join/abc123');
    await user.type(input, 'my-invite-code');

    // Click join
    const submitButton = screen.getByText('Join Space');
    await user.click(submitButton);

    // joinByCode(code, origin) — bare code has no origin, so second arg is
    // undefined (parseInviteInput returns { code, origin: undefined }).
    await waitFor(() => {
      expect(mockJoinByCode).toHaveBeenCalledWith('my-invite-code', undefined);
    });

    // Should navigate to the new space
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/channels/new-space-id');
    });

    // Modal should close (activeModal becomes null)
    expect(useUIStore.getState().activeModal).toBeNull();
  });

  it('shows error message when joinByCode fails', async () => {
    const user = userEvent.setup();
    const mockJoinByCode = vi.fn().mockRejectedValue(new Error('Invalid invite code'));
    useUIStore.setState({ activeModal: 'joinSpace' });
    useSpaceStore.setState({ joinByCode: mockJoinByCode });

    renderModal();

    const input = screen.getByPlaceholderText('e.g. abc123 or https://instance.com/join/abc123');
    await user.type(input, 'bad-code');

    const submitButton = screen.getByText('Join Space');
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Invalid invite code')).toBeInTheDocument();
    });
  });

  it('opens only the invitation path, without fetching or previewing discovery', () => {
    useUIStore.setState({ activeModal: 'joinSpace' });
    renderModal();
    expect(screen.queryByText(/Discover spaces to join/i)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByText('Browse all in Explore')).toBeNull();
  });


  describe('a code of a space joined by request', () => {
    function requestRequired(): JoinRequestRequiredError {
      return new JoinRequestRequiredError(
        new HttpError(403, 'requests', undefined, 'join_request_required', { spaceId: 'S-REQ' }),
        'S-REQ',
        '',
      );
    }

    async function submitCode(user: ReturnType<typeof userEvent.setup>) {
      await user.type(screen.getByPlaceholderText('e.g. abc123 or https://instance.com/join/abc123'), 'reqcode');
      await user.click(screen.getByText('Join Space'));
    }

    it('moves to a request step and sends the request with the note', async () => {
      const user = userEvent.setup();
      const requestJoinSpace = vi.mocked(sendInviteJoinRequest);
      useSpaceStore.setState({ joinByCode: vi.fn().mockRejectedValue(requestRequired()) });
      useUIStore.setState({ activeModal: 'joinSpace' });
      renderModal();

      await submitCode(user);

      expect(await screen.findByText('This space takes join requests. Send one and a manager will review it.')).toBeInTheDocument();
      await user.type(screen.getByLabelText('Note with your request'), 'hello');
      await user.click(screen.getByRole('button', { name: 'Send Request' }));

      expect(requestJoinSpace).toHaveBeenCalledWith('S-REQ', '', 'hello');
      expect(await screen.findByText('Request sent. A manager will review it, and the space appears in your list once they approve.')).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('says a request is already waiting', async () => {
      const user = userEvent.setup();
      useSpaceStore.setState({ joinByCode: vi.fn().mockRejectedValue(requestRequired()) });
      vi.mocked(sendInviteJoinRequest).mockResolvedValue('pending');
      useUIStore.setState({ activeModal: 'joinSpace' });
      renderModal();

      await submitCode(user);
      await user.click(await screen.findByRole('button', { name: 'Send Request' }));

      expect(await screen.findByText('You already asked to join this space. Your request is waiting for a manager.')).toBeInTheDocument();
    });

    it('shows a request already waiting when the join itself answers join_request_pending', async () => {
      const user = userEvent.setup();
      useSpaceStore.setState({
        joinByCode: vi.fn().mockRejectedValue(new HttpError(409, 'pending', undefined, 'join_request_pending')),
      });
      useUIStore.setState({ activeModal: 'joinSpace' });
      renderModal();

      await submitCode(user);

      expect(await screen.findByText('You already asked to join this space. Your request is waiting for a manager.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Send Request' })).not.toBeInTheDocument();
    });
  });
});
