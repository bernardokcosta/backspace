import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useJunoStore } from '../../stores/junoStore';
import { useAuthStore } from '../../stores/authStore';
import { JunoLobby } from './JunoLobby';
import { junoGame, junoUser } from './junoTestFixtures';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
const command = vi.fn(async () => {});
beforeEach(() => {
  command.mockClear(); useJunoStore.getState().reset(); useAuthStore.setState({ user: junoUser() });
  useJunoStore.getState().bind({ accountId: 'a', selfId: 'a', origin: '', channelId: 'voice' }, true);
  useJunoStore.setState({ snapshot: { revision: 1, game: null }, command });
});
describe('Juno cosmic lobby', () => {
  it('creates only on explicit action, and opens ranking without creating/joining', async () => {
    const ranking = vi.fn(); render(<JunoLobby onRanking={ranking} />);
    expect(screen.getByRole('img', { name: 'Juno' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Space ranking' })); expect(ranking).toHaveBeenCalledOnce();
    expect(command).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Create a table' })); expect(command).toHaveBeenCalledWith({ type: 'create' });
  });
  it('keeps explicit joins/start and the two-player minimum', () => {
    const game = junoGame(); game.players = game.players.slice(0, 1);
    useJunoStore.setState({ snapshot: { revision: 2, game } }); render(<JunoLobby onRanking={() => {}} />);
    expect(screen.getByRole('button', { name: 'Start round' })).toBeDisabled();
    expect(screen.getAllByText('Seat available')).toHaveLength(3);
  });
});
