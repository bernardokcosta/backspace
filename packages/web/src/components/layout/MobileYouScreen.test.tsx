import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User } from '@backspace/shared';

// Stub AudioManager to avoid AudioWorkletNode reference error in jsdom.
// Reached transitively via authStore -> voiceStore.
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

import { fireEvent, render, screen, within } from '@testing-library/react';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { MobileYouScreen } from './MobileYouScreen';

const DOT = 'Backspace was updated';

const self: User = {
  id: 'user-self',
  username: 'me',
  displayName: 'Me',
  avatar: null,
  banner: null,
  accentColor: null,
  avatarColor: null,
  bio: null,
  status: 'online',
  customStatus: null,
  isAdmin: false,
  createdAt: 0,
  homeInstance: null,
  homeUserId: null,
  replicatedInstances: [],
};

const pushMobileScreen = vi.fn();
const originalPush = useUIStore.getState().pushMobileScreen;

/** The action row whose label starts with `label` (a dot adds to the name). */
function row(label: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${label}`) });
}

beforeEach(() => {
  pushMobileScreen.mockReset();
  useUIStore.setState({ pushMobileScreen });
  useAuthStore.setState({ user: self });
});

afterEach(() => {
  useUIStore.setState({ pushMobileScreen: originalPush });
  useAuthStore.setState({ user: null });
});

describe('MobileYouScreen after hub retirement', () => {
  it('has no Backspace launcher or hub dot', () => {
    render(<MobileYouScreen />);
    expect(screen.queryByRole('button', { name: /^Backspace/ })).toBeNull();
    expect(screen.queryByRole('img', { name: DOT })).toBeNull();
  });

  it('keeps Friends navigation', () => {
    render(<MobileYouScreen />);
    fireEvent.click(row('Friends'));
    expect(pushMobileScreen).toHaveBeenCalledWith('friends');
  });

  it('puts the dot on no other row', () => {
    render(<MobileYouScreen />);

    for (const label of ['Edit Profile', 'Friends', 'Connections', 'Voice']) {
      expect(within(row(label)).queryByRole('img', { name: DOT })).toBeNull();
    }
  });
});
