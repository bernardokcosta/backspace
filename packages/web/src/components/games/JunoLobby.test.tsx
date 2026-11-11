import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useJunoStore } from '../../stores/junoStore';
import { useAuthStore } from '../../stores/authStore';
import { JunoLobby } from './JunoLobby';
import { junoGame, junoUser } from './junoTestFixtures';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
const command = vi.fn(async () => {});
beforeEach(() => {
  command.mockClear(); useJunoStore.getState().reset(); useAuthStore.setState({ user: junoUser() });
  useJunoStore.getState().bind({ userId: 'a', origin: window.location.origin, channelId: 'voice' }, true);
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
    expect(screen.queryByText('Seat available')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Seat available')).toHaveLength(3);
  });
  it('lets only the capable host add/remove a computer from a real lobby seat', async () => {
    const game = junoGame(); game.supportsBots = true;
    game.players = [game.players[0]!, { userId: 'cpu', name: 'Juno Bot 1', computer: 1, cardCount: 0, announced: false }];
    useJunoStore.setState({ snapshot: { revision: 2, game } }); render(<JunoLobby onRanking={() => {}} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Add computer player' })[0]!);
    expect(command).toHaveBeenCalledWith({ type: 'addBot' });
    await userEvent.click(screen.getByRole('button', { name: /remove.*computer/i }));
    expect(command).toHaveBeenCalledWith({ type: 'removeBot', botId: 'cpu' });
  });
  it('does not advertise computer management to visitors or old hosts', () => {
    const game = junoGame(); game.supportsBots = true;
    useJunoStore.setState({ target: { userId: 'b', origin: window.location.origin, channelId: 'voice' }, snapshot: { revision: 2, game } });
    const { rerender } = render(<JunoLobby onRanking={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Add computer player' })).not.toBeInTheDocument();
    act(() => useJunoStore.setState({ target: { userId: 'a', origin: window.location.origin, channelId: 'voice' }, snapshot: { revision: 3, game: { ...game, supportsBots: undefined } } }));
    rerender(<JunoLobby onRanking={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Add computer player' })).not.toBeInTheDocument();
  });
});
