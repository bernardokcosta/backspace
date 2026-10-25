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

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useChatStore } from '../../stores/chatStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { ChannelSidebar } from './ChannelSidebar';

const SELECTED = 'bg-interactive-selected';
const LABELS = { friends: 'Friends', explore: 'Explore' } as const;

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <ChannelSidebar />
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** The clickable row of a home item, found by its visible label. */
function homeItem(label: string): HTMLElement {
  const row = screen.getByText(label, { selector: 'span' }).parentElement;
  if (!row) throw new Error(`no row for ${label}`);
  return row;
}

function selectedItems(): string[] {
  return Object.entries(LABELS)
    .filter(([, label]) => homeItem(label).classList.contains(SELECTED))
    .map(([key]) => key);
}

beforeEach(() => {
  useChatStore.setState({ currentChannelId: null });
  useSpaceStore.setState({ spaces: [], currentSpaceId: null, channels: [], dmChannels: [] });
  useUIStore.setState({ showDms: true });
});

describe('ChannelSidebar home items', () => {
  it('selects only Explore on /explore', () => {
    renderAt('/explore');
    expect(selectedItems()).toEqual(['explore']);
  });

  it('has no hub launcher or hub update dot, including on an old bookmark', () => {
    renderAt('/backspace');
    expect(screen.queryByText('Backspace', { selector: 'span' })).toBeNull();
    expect(screen.queryByRole('img', { name: 'Backspace was updated' })).toBeNull();
  });

  it('selects only Friends on the DM home', () => {
    renderAt('/channels/@me');
    expect(selectedItems()).toEqual(['friends']);
  });

  it('selects none of them while a DM is open', () => {
    useChatStore.setState({ currentChannelId: 'dm-1' });
    renderAt('/channels/@me/dm-1');
    expect(selectedItems()).toEqual([]);
  });

  it('still navigates to Friends from Explore', () => {
    renderAt('/explore');
    fireEvent.click(homeItem(LABELS.friends));
    expect(screen.getByTestId('location')).toHaveTextContent('/channels/@me');
  });

  it('no longer renders the Coming Soon placeholder', () => {
    renderAt('/channels/@me');
    expect(screen.queryByText('Coming Soon')).toBeNull();
  });

});
