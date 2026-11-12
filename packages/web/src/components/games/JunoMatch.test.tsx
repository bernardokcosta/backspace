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
  useJunoStore.getState().bind({ userId: 'a', origin: window.location.origin, channelId: 'voice' }, true);
  useJunoStore.setState({ snapshot: { revision: 1, game: junoGame('playing') }, observedAt: Date.now(), command });
});
describe('Juno cosmic interactive match', () => {
  it('plays Entorpecido without a color picker and uses its supplied card art', async () => {
    const game = junoGame('playing'); game.hand = [{ id: 'intoxicated', face: 'intoxicated', color: null }];
    useJunoStore.setState({ snapshot: { revision: 2, game } }); const { container } = render(<JunoMatch />);
    const button = screen.getByRole('button', { name: /play.*intoxicated/i });
    expect(button).toBeEnabled(); expect(container.querySelector('.juno-hand img')).toHaveAttribute('src', '/games/juno/cards/intoxicated.webp');
    await userEvent.click(button);
    expect(command).toHaveBeenCalledWith({ type: 'play', cardId: 'intoxicated', announce: false });
    expect(screen.queryByRole('button', { name: 'Green' })).not.toBeInTheDocument();
  });
  it('distorts only the victim table, keeps real hand/actions readable, and clears on confirmed end', () => {
    const game = junoGame('playing'); game.intoxication = { id: 'intoxication', targetUserId: 'a' };
    useJunoStore.setState({ snapshot: { revision: 2, game } }); const { container } = render(<JunoMatch />);
    expect(container.querySelector('.juno-intoxicated-active .juno-intoxicated-haze')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Your hand' })).toHaveAccessibleDescription(/50%/);
    expect(container.querySelectorAll('.juno-hand img')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Draw pile' })).toBeEnabled();
    act(() => useJunoStore.setState({ snapshot: { revision: 3, game: { ...game, intoxication: undefined } } }));
    expect(container.querySelector('.juno-intoxicated-active,.juno-intoxicated-haze')).toBeNull();
  });
  it('marks an affected opponent without distorting another viewer or a spectator', () => {
    const game = junoGame('playing'); game.intoxication = { id: 'intoxication', targetUserId: 'b' };
    useJunoStore.setState({ snapshot: { revision: 2, game } }); const { container } = render(<JunoMatch />);
    expect(container.querySelector('.juno-seat-intoxicated')).toBeInTheDocument();
    expect(container.querySelector('.juno-intoxicated-active,.juno-intoxicated-haze')).toBeNull();
    act(() => useJunoStore.setState({ target: { userId: 'watcher', origin: window.location.origin, channelId: 'voice' }, snapshot: { revision: 3, game: { ...game, hand: [] } } }));
    expect(container.querySelector('.juno-intoxicated-active,.juno-intoxicated-haze')).toBeNull();
  });
  it('masks the victim without front URLs, color labels, legal highlights or a wildcard picker', async () => {
    const game = junoGame('playing'); game.hand = []; game.color = null; game.topCard = null;
    game.memoryEnabled = true; game.memoryCurse = { id: 'curse', targetUserId: 'a' };
    game.maskedHand = [{ id: 'hidden-1' }, { id: 'hidden-2' }]; game.supportsAnnounce = true;
    useJunoStore.setState({ snapshot: { revision: 2, game } }); const { container } = render(<JunoMatch />);
    const hidden = screen.getByRole('button', { name: 'Hidden card 1' });
    expect(hidden).toBeEnabled(); expect(hidden).toHaveAttribute('title', 'Hidden card 1');
    expect(container.querySelector('.juno-hand img,.juno-active-color,.juno-card-legal')).toBeNull();
    expect(screen.queryByLabelText(/color:/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Draw pile' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /say juno/i })).toBeEnabled();
    await userEvent.click(hidden);
    expect(command).toHaveBeenCalledWith({ type: 'play', cardId: 'hidden-1', announce: false });
    expect(screen.queryByRole('button', { name: 'Green' })).not.toBeInTheDocument();
  });
  it('plays the memory card over any color without opening color selection', async () => {
    const game = junoGame('playing'); game.hand = [{ id: 'rare', face: 'memory', color: null }];
    useJunoStore.setState({ snapshot: { revision: 2, game } }); render(<JunoMatch />);
    await userEvent.click(screen.getByRole('button', { name: /play.*alzheimer/i }));
    expect(command).toHaveBeenCalledWith({ type: 'play', cardId: 'rare', announce: false });
    expect(screen.queryByRole('button', { name: 'Green' })).not.toBeInTheDocument();
  });
  it('does not mask an unaffected player and disables hidden actions for stale views', () => {
    const game = junoGame('playing'); game.memoryCurse = { id: 'curse', targetUserId: 'b' };
    useJunoStore.setState({ snapshot: { revision: 2, game } }); const { container } = render(<JunoMatch />);
    expect(container.querySelectorAll('.juno-hand img')).toHaveLength(2);
    act(() => useJunoStore.setState({ stale: true, snapshot: { revision: 3, game: { ...game, hand: [], color: null, topCard: null,
      memoryCurse: { id: 'curse-2', targetUserId: 'a' }, maskedHand: [{ id: 'hidden-1' }] } } }));
    expect(screen.getByRole('button', { name: 'Hidden card 1' })).toBeDisabled();
  });
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
    useJunoStore.setState({ target: { userId: 'watcher', origin: window.location.origin, channelId: 'voice' }, snapshot: { revision: 2, game } });
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
    expect(button.textContent).toBe('');
    expect(button.querySelector('img')).toHaveAttribute('src', '/games/juno/ui/hammer-still.webp');
    expect(button).toHaveAccessibleDescription('10 seconds left to report');
    expect(container.querySelector('.juno-report-time,.juno-report-label')).toBeNull();
    expect(container.querySelector('[data-seat="top"] .juno-opponent-cards img')).toBeInTheDocument();
    await userEvent.click(button);
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
    act(() => vi.advanceTimersByTime(2000)); expect(button).toHaveAccessibleDescription('1 seconds left to report');
    act(() => useJunoStore.setState({ pending: true })); expect(button).toBeDisabled();
    act(() => useJunoStore.setState({ pending: false }));
    act(() => vi.advanceTimersByTime(1000)); expect(button).toBeDisabled();
    fireEvent.click(button); expect(command).not.toHaveBeenCalled();
  });
  it.each(['old-host', 'self', 'spectator', 'disconnected'])('does not allow reporting as %s', mode => {
    const game = junoGame('playing'); game.supportsReports = mode !== 'old-host'; game.players[1]!.cardCount = 1;
    game.reportOpportunities = [{ id: 'miss', targetUserId: mode === 'self' ? 'a' : 'b', remainingMs: 1000 }];
    useJunoStore.setState({ snapshot: { revision: 4, game }, connected: mode !== 'disconnected',
      ...(mode === 'spectator' ? { target: { userId: 'w', origin: window.location.origin, channelId: 'voice' } } : {}) });
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
    expect(container.querySelector('.juno-effect-report')).toHaveAttribute('data-from', 'top');
    expect(container.querySelector('.juno-effect-draw,.juno-effect-special')).toBeNull();
  });
  it('retains seat anchors and existing backs through confirmation and the next ordinary move', () => {
    const game = junoGame('playing'); game.supportsReports = true; game.players[1]!.cardCount = 1;
    game.reportOpportunities = [{ id: 'stable-miss', targetUserId: 'b', remainingMs: 10_000 }];
    useJunoStore.setState({ snapshot: { revision: 2, game } });
    const { container } = render(<JunoMatch />);
    const anchor = container.querySelector('[data-seat="top"] .juno-report-anchor');
    const back = container.querySelector('[data-seat="top"] .juno-opponent-cards img');
    expect(anchor).toBeInTheDocument(); expect(back).toBeInTheDocument();
    const reported = { ...game, reportOpportunities: [], players: game.players.map(p => p.userId === 'b' ? { ...p, cardCount: 3 } : p),
      lastMove: { id: 'stable-report', type: 'report' as const, userId: 'a', targetUserId: 'b', amount: 2 } };
    act(() => useJunoStore.setState({ snapshot: { revision: 3, game: reported } }));
    expect(container.querySelector('[data-seat="top"] .juno-report-anchor')).toBe(anchor);
    expect(container.querySelector('[data-seat="top"] .juno-opponent-cards img')).toBe(back);
    expect(container.querySelectorAll('[data-seat="top"] .juno-opponent-cards img')).toHaveLength(3);
    act(() => useJunoStore.setState({ snapshot: { revision: 4, game: { ...reported,
      lastMove: { id: 'next-turn', type: 'draw', userId: 'a', amount: 1 } } } }));
    expect(container.querySelector('[data-seat="top"] .juno-report-anchor')).toBe(anchor);
    expect(container.querySelector('[data-seat="top"] .juno-opponent-cards img')).toBe(back);
  });
});
