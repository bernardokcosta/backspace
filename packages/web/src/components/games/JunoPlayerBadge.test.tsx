import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { JunoPlayerBadge } from './JunoPlayerBadge';
import { junoUser } from './junoTestFixtures';
import { useSpaceStore } from '../../stores/spaceStore';
const upload = vi.hoisted(() => vi.fn((name: string | null | undefined) => name ? `/api/uploads/${name}` : null));
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
vi.mock('../../utils/assetUrls', () => ({ uploadUrl: upload }));
beforeEach(() => useSpaceStore.setState({ userViews: new Map() }));
describe('Juno platform player identity', () => {
  it('forgets the old session profile and reacts to native profile changes', () => {
    useSpaceStore.getState().upsertUserView(junoUser('a', 'Different person'));
    useSpaceStore.getState().reset();
    const row = junoUser('a', 'Hosted Ada');
    render(<JunoPlayerBadge person={{ userId: 'a', name: row.displayName!, user: row }} spaceId="space" />);
    expect(screen.getByText('Hosted Ada')).toBeInTheDocument();
    expect(screen.queryByText('Different person')).not.toBeInTheDocument();
    act(() => useSpaceStore.getState().upsertUserView({ ...row, displayName: 'Updated Ada', avatar: 'new.webp' }));
    expect(screen.getByText('Updated Ada')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Updated Ada' })).toHaveAttribute('src', '/api/uploads/new.webp');
  });
  it('uses the real provided profile, nickname and current avatar URL', () => {
    const user = { ...junoUser('native-row', 'Real Ada'), avatar: 'photo.webp' };
    render(<JunoPlayerBadge person={{ userId: user.id, name: 'Old name', user, nickname: 'Captain' }} spaceId="space" />);
    expect(screen.getByText('Captain')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Captain' })).toHaveAttribute('src', '/api/uploads/photo.webp');
    expect(upload).toHaveBeenCalledWith('photo.webp');
  });
  it('falls back to the real server name instead of a different-id profile or demo face', () => {
    const { container } = render(<JunoPlayerBadge person={{ userId: 'a', name: 'Actual person', user: junoUser('wrong') }} spaceId="space" />);
    expect(screen.getByText('Actual person')).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/demo|lucas|camila|photo.webp/i);
  });
});
