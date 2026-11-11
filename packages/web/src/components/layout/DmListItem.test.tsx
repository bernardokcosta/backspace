import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DmChannel } from '@veyvox/shared';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { DmListItem } from './DmListItem';
import { junoUser } from '../games/junoTestFixtures';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';
const me = junoUser('me', 'Me'), partner = { ...junoUser('other'), username: 'exact@retained.invalid', displayName: null };
const dm: DmChannel = { id: 'dm', ownerId: null, name: null, icon: null, createdAt: 1, members: [me, partner] };
const select = vi.fn(), close = vi.fn(), leave = vi.fn();
beforeEach(() => { useAuthStore.setState({ user: me }); useSpaceStore.getState().reset(); vi.clearAllMocks(); });
afterEach(cleanup);
describe('native DM list rows', () => {
  const props = { dm, user: me, isActive: false, isUnread: false, onSelect: select, onClose: close, onLeave: leave };
  it('names the native partner verbatim, with no foreign-identity badge or tooltip wrapper', () => {
    const { container } = render(<DmListItem {...props} />);
    expect(screen.getByText(partner.username)).toBeInTheDocument(); expect(container.querySelectorAll('svg')).toHaveLength(1);
    fireEvent.click(screen.getByText(partner.username)); expect(select).toHaveBeenCalledWith(dm.id);
    fireEvent.click(screen.getByRole('button')); expect(close).toHaveBeenCalledWith(dm.id); expect(leave).not.toHaveBeenCalled();
  });
  it('passes only the native partner to the invitation context and leaves groups through the group action', () => {
    const menu = vi.fn(); const view = render(<DmListItem {...props} onContextMenu={menu} />);
    fireEvent.contextMenu(screen.getByText(partner.username)); expect(menu.mock.calls[0]?.[2]).toEqual({ user: partner });
    view.rerender(<DmListItem {...props} dm={{ ...dm, ownerId: me.id, name: 'Crew' }} />);
    fireEvent.click(screen.getByRole('button')); expect(leave).toHaveBeenCalledWith(dm.id);
  });
  it('keeps hooks stable when an initially empty DM receives its roster', () => {
    const view = render(<DmListItem {...props} dm={{ ...dm, members: [me] }} />);
    expect(view.container).toBeEmptyDOMElement(); view.rerender(<DmListItem {...props} />);
    expect(screen.getByText(partner.username)).toBeInTheDocument();
  });
});
