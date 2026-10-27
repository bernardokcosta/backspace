import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { useChatStore } from '../../stores/chatStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { ChannelSidebar } from './ChannelSidebar';

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <ChannelSidebar />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useChatStore.setState({ currentChannelId: null });
  useSpaceStore.setState({ spaces: [], currentSpaceId: null, channels: [], dmChannels: [] });
  useUIStore.setState({ showDms: true });
});

describe('ChannelSidebar DM view', () => {
  it('has no Explore launcher for a retired bookmark', () => {
    renderAt('/explore');
    expect(screen.queryByText('Explore', { selector: 'span' })).toBeNull();
  });

  it('has no hub launcher or hub update dot, including on an old bookmark', () => {
    renderAt('/backspace');
    expect(screen.queryByText('Backspace', { selector: 'span' })).toBeNull();
    expect(screen.queryByRole('img', { name: 'Backspace was updated' })).toBeNull();
  });

  it('does not render a redundant Friends button above Direct Messages', () => {
    renderAt('/channels/@me');
    expect(screen.queryByText('Friends', { selector: 'span' })).toBeNull();
    expect(screen.getByText('Direct Messages', { selector: 'span' })).toBeInTheDocument();
  });

  it('no longer renders the Coming Soon placeholder', () => {
    renderAt('/channels/@me');
    expect(screen.queryByText('Coming Soon')).toBeNull();
  });
});
