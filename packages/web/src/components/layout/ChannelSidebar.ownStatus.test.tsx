import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User } from '@veyvox/shared';

// Stub AudioManager to avoid AudioWorkletNode reference error in jsdom.
// Reached transitively via the voice components and stores.
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { ChannelSidebar } from './ChannelSidebar';

function user(fields: Partial<User> & Pick<User, 'id' | 'username'>): User {
  return {
    displayName: null, avatar: null, banner: null, accentColor: null, avatarColor: null,
    bio: null, status: 'online', customStatus: null, isAdmin: false, createdAt: 1, ...fields,
  } as User;
}

/** The status dot on the avatar in the user area at the bottom of the sidebar. */
function ownDotClass(username: string): string {
  const handle = screen.getByText(`@${username}`);
  const area = handle.closest('div.group');
  const dot = area?.querySelector('[data-avatar] > div.absolute');
  if (!dot) throw new Error('no status dot in the user area');
  return dot.className;
}

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={['/channels/@me']}>
      <ChannelSidebar />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useChatStore.setState({ currentChannelId: null });
  useSpaceStore.setState({ spaces: [], currentSpaceId: null, channels: [], dmChannels: [] });
  useUIStore.setState({ showDms: true });
});

afterEach(() => {
  useAuthStore.setState({ user: null });
});

describe('ChannelSidebar own status dot', () => {
  it('shows the chosen native status for a retained @ account handle', () => {
    const erin = user({
      id: 'erin-here', username: 'erin@nova.example', status: 'dnd',
    });
    useAuthStore.setState({ user: erin });

    renderSidebar();

    expect(ownDotClass('erin@nova.example')).toContain('bg-status-dnd');
  });

  it("shows a native session's own status", () => {
    const jannis = user({ id: 'jannis', username: 'jannis', status: 'idle' });
    useAuthStore.setState({ user: jannis });

    renderSidebar();

    expect(ownDotClass('jannis')).toContain('bg-status-idle');
  });
});
