import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JunoView } from '@backspace/shared/src/juno';
import { useJunoStore } from '../../stores/junoStore';
import { JunoTable } from './JunoTable';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));

const command = vi.fn(async () => {});
function game(phase: JunoView['phase'] = 'lobby'): JunoView {
  return { id: 'game', phase, hostId: 'a', players: [{ userId: 'a', name: 'Ada', cardCount: 2, announced: false },
    { userId: 'b', name: 'Bo', cardCount: 7, announced: false }], hand: phase === 'lobby' ? [] : [
    { id: 'wild', face: 'wild', color: null }, { id: 'number', face: '8', color: 'sky' }], topCard: { id: 'top', face: '3', color: 'coral' },
    color: 'coral', direction: 1, currentPlayerId: 'a', drawnCardId: null, remainingMs: 40_000, winnerId: null, result: null, lastMove: null };
}
beforeEach(() => {
  command.mockClear(); useJunoStore.getState().reset();
  useJunoStore.setState({ target: { accountId: 'a', selfId: 'a', origin: '', channelId: 'voice' },
    connected: true, snapshot: { revision: 1, game: game() }, observedAt: Date.now(), command, open: true });
});
describe('Juno native table', () => {
  it('focuses a leave confirmation and consumes Escape without mutating the game', async () => {
    render(<JunoTable />); const leave = screen.getByRole('button', { name: 'Leave game' });
    await userEvent.click(leave);
    expect(screen.getByRole('group', { name: /leave this game/i })).toContainElement(document.activeElement as HTMLElement);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: /leave this game/i })).not.toBeInTheDocument();
    expect(command).not.toHaveBeenCalled(); expect(leave).toHaveFocus();
  });
  it('navigates to the ranking and back without losing a private hand or sending commands', async () => {
    useJunoStore.setState({ snapshot: { revision: 1, game: game('playing') } }); render(<JunoTable />);
    await userEvent.click(screen.getByRole('button', { name: 'Space ranking' }));
    await userEvent.click(screen.getByRole('button', { name: 'Back to table' }));
    expect(screen.getByRole('group', { name: 'Your hand' })).toBeInTheDocument();
    expect(command).not.toHaveBeenCalled();
  });
  it('starts a lobby using a real button and minimizing does not leave the game', async () => {
    render(<JunoTable />);
    await userEvent.click(screen.getByRole('button', { name: /start round/i })); expect(command).toHaveBeenCalledWith({ type: 'start' });
    await userEvent.click(screen.getByRole('button', { name: /back to mosaic/i }));
    expect(useJunoStore.getState().open).toBe(false); expect(command).toHaveBeenCalledTimes(1);
  });
  it('requires an explicit wild color and includes the Juno declaration', async () => {
    useJunoStore.setState({ snapshot: { revision: 1, game: game('playing') } }); render(<JunoTable />);
    await userEvent.click(screen.getByRole('checkbox', { name: /say juno/i }));
    await userEvent.click(screen.getByRole('button', { name: /play.*wild/i })); expect(command).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Green' }));
    expect(command).toHaveBeenCalledWith({ type: 'play', cardId: 'wild', color: 'mint', announce: true });
    expect(screen.getByRole('button', { name: /play.*blue.*8/i })).toBeDisabled();
  });
  it('shows spectators no hand and no draw action', () => {
    useJunoStore.setState({ target: { accountId: 'c', selfId: 'c', origin: '', channelId: 'voice' }, snapshot: { revision: 1, game: { ...game('playing'), hand: [] } } });
    render(<JunoTable />); expect(screen.getByText(/you’re watching/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^draw one/i })).not.toBeInTheDocument();
  });
});
