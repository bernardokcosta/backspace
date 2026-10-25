import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: vi.fn(() => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() })) } }));
import { AccessPanel } from './SpaceSettings';
import { useSpaceStore, type TaggedSpace } from '../../stores/spaceStore';
import { api } from '../../api/client';

const space: TaggedSpace = { id: 's1', name: 'Retained', icon: null, banner: null, avatarColor: null,
  ownerId: 'owner', inviteCode: null, visibility: 'private', directoryListed: true,
  description: 'Old description', createdAt: 1, _instanceOrigin: '' };
const updateSpace = vi.fn();
beforeEach(() => {
  updateSpace.mockReset().mockResolvedValue(undefined);
  useSpaceStore.setState({ spaces: [space], updateSpace });
  vi.spyOn(api.joinRequests, 'list').mockResolvedValue({ requests: [] });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('space access retained after directory removal', () => {
  it.each(['Private', 'Request to Join', 'Public'])('keeps %s editable without directory flags or controls', async (label) => {
    render(<AccessPanel spaceId="s1" />);
    expect(screen.queryByRole('switch', { name: 'List in the global Backspace directory' })).toBeNull();
    const choice = screen.getByRole('radio', { name: new RegExp(label) });
    fireEvent.click(choice);
    await userEvent.type(screen.getByRole('textbox'), ' changed');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(updateSpace).toHaveBeenCalledWith('s1', { visibility: choice.getAttribute('value'), description: 'Old description changed' });
  });
  it('resets unsaved fields without a write', async () => {
    render(<AccessPanel spaceId="s1" />);
    await userEvent.type(screen.getByRole('textbox'), ' changed');
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('textbox')).toHaveValue('Old description');
    expect(updateSpace).not.toHaveBeenCalled();
  });
});
