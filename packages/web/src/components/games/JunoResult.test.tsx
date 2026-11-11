import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useJunoStore } from '../../stores/junoStore';
import { JunoResult } from './JunoResult';
import { junoGame } from './junoTestFixtures';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
beforeEach(() => {
  useJunoStore.getState().reset();
  const game = junoGame('finished'); game.winnerId = 'a'; game.result = 'emptyHand';
  game.scoreboard = { roundId: game.id, status: 'credited', standings: game.players.map((p, i) => ({
    ...p, place: i === 0 ? 1 : 2, cardCount: i === 0 ? 0 : 7, xp: i === 0 ? 120 : 80, outcome: 'completed',
  })) };
  useJunoStore.setState({ target: { userId: 'a', origin: window.location.origin, channelId: 'voice' },
    connected: true, snapshot: { revision: 1, game }, command: vi.fn(async () => {}) });
});
describe('Juno authoritative result view', () => {
  it.each(['playersLeft', 'stalemate', 'expired'] as const)('shows a neutral %s outcome without a crown or invented XP', result => {
    const game = junoGame('finished'); game.result = result;
    game.scoreboard = { roundId: game.id, status: 'unranked', standings: game.players.map(p => ({ ...p, place: null, xp: 0, outcome: 'unranked' })) };
    useJunoStore.setState({ snapshot: { revision: 2, game } });
    const { container } = render(<JunoResult />);
    expect(container.querySelector('.juno-crown')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Round results' })).toBeInTheDocument();
    expect(screen.getAllByText('No XP this round')).toHaveLength(2);
    expect(screen.queryByText(/XP earned/)).not.toBeInTheDocument();
  });
  it('shows actual awards and victory only for the winner', () => {
    render(<JunoResult />); expect(screen.getByRole('heading', { name: 'Victory!' })).toBeInTheDocument();
    expect(screen.getByText('+120 XP earned')).toBeInTheDocument();
    expect(screen.getByText('+80 XP earned')).toBeInTheDocument();
  });
  it('does not claim personal victory for a loser or allow their rematch', () => {
    useJunoStore.setState({ target: { userId: 'b', origin: window.location.origin, channelId: 'voice' } });
    render(<JunoResult />); expect(screen.queryByRole('heading', { name: 'Victory!' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open a new lobby/i })).not.toBeInTheDocument();
  });
  it('shows pending without confirmed earned XP or an enabled rematch', () => {
    const snapshot = useJunoStore.getState().snapshot!;
    useJunoStore.setState({ snapshot: { ...snapshot, game: { ...snapshot.game!, scoreboard: { ...snapshot.game!.scoreboard!, status: 'pending' } } } });
    render(<JunoResult />); expect(screen.getByText(/saving this round/i)).toBeInTheDocument();
    expect(screen.queryByText('+120 XP earned')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open a new lobby/i })).toBeDisabled();
  });
  it('supports old hosts without inventing a scoreboard', () => {
    const game = { ...junoGame('finished'), winnerId: 'b', result: 'emptyHand' as const };
    useJunoStore.setState({ snapshot: { revision: 2, game } }); render(<JunoResult />);
    expect(screen.queryByText(/XP earned/)).not.toBeInTheDocument(); expect(screen.getByText('Bo wins!')).toBeInTheDocument();
  });
  it('labels computer results as practice rather than earned XP', () => {
    const snapshot = useJunoStore.getState().snapshot!;
    const game = { ...snapshot.game!, practice: true };
    game.scoreboard = { ...game.scoreboard!, status: 'unranked', standings: game.scoreboard!.standings.map(p => ({ ...p, xp: 0 })) };
    useJunoStore.setState({ snapshot: { ...snapshot, game } }); render(<JunoResult />);
    expect(screen.getAllByText('Practice')).toHaveLength(2);
    expect(screen.queryByText(/XP earned/)).not.toBeInTheDocument();
  });
});
