import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useJunoStore } from '../../stores/junoStore';
import { JunoMatch } from './JunoMatch';
import { junoGame } from './junoTestFixtures';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
const command = vi.fn(async () => {});
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  command.mockClear(); useJunoStore.getState().reset();
  useJunoStore.getState().bind({ accountId: 'a', selfId: 'a', origin: '', channelId: 'voice' }, true);
  useJunoStore.setState({ snapshot: { revision: 1, game: junoGame('playing') }, observedAt: Date.now(), command });
});
describe('Juno cosmic interactive match', () => {
  it('spreads each lateral back separately while preserving its exact public count', () => {
    const game = junoGame('playing');
    game.players.push({ ...game.players[1]!, userId: 'c', name: 'Eli' }, { ...game.players[1]!, userId: 'd', name: 'Noor' });
    useJunoStore.setState({ snapshot: { revision: 2, game } });
    const { container } = render(<JunoMatch />);
    for (const position of ['left', 'right']) {
      const side = container.querySelector(`[data-seat="${position}"]`)!;
      expect(side).toHaveTextContent('7 cards');
      expect(side.querySelectorAll('.juno-side-card')).toHaveLength(7);
      expect(side.querySelectorAll('img[src="/games/juno/cards/back.webp"]')).toHaveLength(7);
      expect(side.querySelectorAll('.juno-side-card')[3]).toHaveStyle({ '--juno-card-tilt': '0deg' });
    }
    expect(container.querySelector('[data-seat="top"] .juno-side-hand')).not.toBeInTheDocument();
  });
  it('keeps independent piles and explicit wild/Juno actions', async () => {
    const { container } = render(<JunoMatch />);
    expect(container.querySelector('[data-seat="bottom"]')).toHaveTextContent('Ada');
    expect(screen.getByRole('button', { name: 'Draw pile' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /say juno/i }));
    await userEvent.click(screen.getByRole('button', { name: /play.*wild/i })); expect(command).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Green' }));
    expect(command).toHaveBeenCalledWith({ type: 'play', cardId: 'wild', color: 'mint', announce: true });
  });
  it('announces immediately on capable hosts and never invents an effect before confirmation', async () => {
    const game = junoGame('playing'); game.supportsAnnounce = true;
    useJunoStore.setState({ snapshot: { revision: 2, game } });
    const { container } = render(<JunoMatch />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Seat available')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /say juno/i }));
    expect(command).toHaveBeenCalledWith({ type: 'announce' });
    expect(container.querySelector('.juno-effect-announce')).not.toBeInTheDocument();
  });
  it('cancels wild color selection with Escape without playing a card', async () => {
    render(<JunoMatch />); const wild = screen.getByRole('button', { name: /play.*wild/i });
    await userEvent.click(wild); await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Green' })).not.toBeInTheDocument();
    expect(command).not.toHaveBeenCalled(); expect(wild).toHaveFocus();
  });
  it('caps decorative opponent fans, but not the real count or scrollable own hand', () => {
    const game = junoGame('playing'); game.players[1]!.cardCount = 85;
    game.hand = Array.from({ length: 20 }, (_, i) => ({ id: `own-${i}`, color: 'coral', face: '3' }));
    useJunoStore.setState({ snapshot: { revision: 2, game } }); const { container } = render(<JunoMatch />);
    expect(screen.getByText('85 cards')).toBeInTheDocument();
    expect(container.querySelectorAll('.juno-opponent-cards .juno-card-art')).toHaveLength(10);
    expect(container.querySelectorAll('.juno-hand .juno-card-art')).toHaveLength(20);
  });
  it('shows a spectator only opponents and no private hand or draw action', () => {
    const game = junoGame('playing'); game.hand = [];
    useJunoStore.setState({ target: { accountId: 'watcher', selfId: 'watcher', origin: '', channelId: 'voice' }, snapshot: { revision: 2, game } });
    render(<JunoMatch />); expect(screen.queryByRole('group', { name: 'Your hand' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Draw pile' })).not.toBeInTheDocument();
    expect(screen.getByText(/you’re watching/i)).toBeInTheDocument();
  });
  it('reports another player outside its own turn without optimistic penalty feedback', async () => {
    const game = junoGame('playing'); game.supportsReports = true; game.currentPlayerId = 'b'; game.players[1]!.cardCount = 1;
    game.reportOpportunities = [{ id: 'miss-1', targetUserId: 'b', remainingMs: 10_000 }];
    useJunoStore.setState({ snapshot: { revision: 2, game } });
    const { container } = render(<JunoMatch />);
    const button = screen.getByRole('button', { name: /report bo/i });
    expect(button).toHaveTextContent('10'); await userEvent.click(button);
    expect(command).toHaveBeenCalledWith({ type: 'report', targetUserId: 'b', opportunityId: 'miss-1' });
    expect(container.querySelector('.juno-effect-draw')).toBeNull();
    expect(screen.getByText('1 card')).toBeInTheDocument();
  });
  it('anchors the report countdown to receipt time and disables expired or pending actions', () => {
    vi.useFakeTimers(); vi.setSystemTime(900_000);
    const game = junoGame('playing'); game.supportsReports = true; game.players[1]!.cardCount = 1;
    game.reportOpportunities = [{ id: 'miss-2', targetUserId: 'b', remainingMs: 3000 }];
    useJunoStore.setState({ snapshot: { revision: 3, game }, observedAt: Date.now() }); render(<JunoMatch />);
    const button = screen.getByRole('button', { name: /report bo/i }); expect(button).toBeEnabled();
    act(() => vi.advanceTimersByTime(2000)); expect(button).toHaveTextContent('1');
    act(() => useJunoStore.setState({ pending: true })); expect(button).toBeDisabled();
    act(() => useJunoStore.setState({ pending: false }));
    act(() => vi.advanceTimersByTime(1000)); expect(button).toBeDisabled();
    fireEvent.click(button); expect(command).not.toHaveBeenCalled();
  });
  it.each(['old-host', 'self', 'spectator', 'disconnected'])('does not allow reporting as %s', mode => {
    const game = junoGame('playing'); game.supportsReports = mode !== 'old-host'; game.players[1]!.cardCount = 1;
    game.reportOpportunities = [{ id: 'miss', targetUserId: mode === 'self' ? 'a' : 'b', remainingMs: 1000 }];
    useJunoStore.setState({ snapshot: { revision: 4, game }, connected: mode !== 'disconnected',
      ...(mode === 'spectator' ? { target: { accountId: 'w', selfId: 'w', origin: '', channelId: 'voice' } } : {}) });
    render(<JunoMatch />);
    if (mode === 'disconnected') expect(screen.getByRole('button', { name: /report bo/i })).toBeDisabled();
    else expect(screen.queryByRole('button', { name: /report .*juno/i })).not.toBeInTheDocument();
  });
  it('announces a confirmed report with both names and anchors drawing to its target', () => {
    const game = junoGame('playing'); useJunoStore.setState({ snapshot: { revision: 4, game } });
    const { container } = render(<JunoMatch />);
    act(() => useJunoStore.setState({ snapshot: { revision: 5, game: { ...game,
      lastMove: { id: 'report-1', type: 'report', userId: 'a', targetUserId: 'b', amount: 2 } } } }));
    expect(screen.getByRole('status', { name: /report/i })).toHaveTextContent(/ada.*bo.*2/i);
    expect(container.querySelector('.juno-effect-draw')).toHaveAttribute('data-from', 'top');
  });
});
