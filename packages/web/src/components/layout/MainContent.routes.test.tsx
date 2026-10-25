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

// The pages themselves have their own tests; here only which one renders matters.
vi.mock('../chat/FriendsPage', () => ({ FriendsPage: () => <div data-testid="page">friends</div> }));

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useChatStore } from '../../stores/chatStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { MainContent } from './MainContent';

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <MainContent />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useChatStore.setState({ currentChannelId: null });
  useSpaceStore.setState({ currentSpaceId: null, channels: [], dmChannels: [] });
  useUIStore.setState({ showDms: false });
});

describe('MainContent home pages', () => {
  it('does not mount a hub for a retired bookmark', () => {
    useUIStore.setState({ showDms: true });
    renderAt('/backspace');
    expect(screen.getByTestId('page')).toHaveTextContent('friends');
  });

  it('does not mount discovery for an old Explore bookmark', () => {
    renderAt('/explore');
    expect(screen.getByTestId('page')).toHaveTextContent('friends');
  });

  it('renders Friends on the DM home', () => {
    useUIStore.setState({ showDms: true });
    renderAt('/channels/@me');
    expect(screen.getByTestId('page')).toHaveTextContent('friends');
  });

});
