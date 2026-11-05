import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useJunoStore } from '../../stores/junoStore';
import { JunoMatch } from './JunoMatch';
import { junoGame } from './junoTestFixtures';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
const command = vi.fn(async () => {});
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
});
