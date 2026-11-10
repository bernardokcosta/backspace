import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JunoView } from '@veyvox/shared/src/juno';
import { useJunoStore } from '../../stores/junoStore';
import { RateLimitError } from '../../api/client';
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
  it('routes enabled clicks and keyboard card selection to local audio, including settings portals', async () => {
    const feedback = vi.fn();
    useJunoStore.setState({ snapshot: { revision: 1, game: game('playing') }, playFeedback: feedback });
    render(<JunoTable />);
    await userEvent.click(screen.getByRole('button', { name: /play.*blue.*8/i }));
    expect(feedback).not.toHaveBeenCalled();
    const wild = screen.getByRole('button', { name: /play.*wild/i }); wild.focus();
    await userEvent.keyboard('{Enter}'); expect(feedback).toHaveBeenLastCalledWith('select');
    await userEvent.click(screen.getByRole('button', { name: 'Juno settings' }));
    expect(feedback).toHaveBeenLastCalledWith('button');
    feedback.mockClear(); await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(feedback).toHaveBeenCalledExactlyOnceWith('button'); expect(command).not.toHaveBeenCalled();
  });
  it('groups accessible icon-only header actions on the right, including settings', () => {
    useJunoStore.setState({ snapshot: { revision: 1, game: game('playing') } });
    const { container } = render(<JunoTable />);
    const actions = container.querySelector('.juno-header-actions');
    for (const name of ['Space ranking', 'Juno settings', 'Leave game', 'Back to mosaic']) {
      const button = screen.getByRole('button', { name });
      expect(actions).toContainElement(button); expect(button).toHaveClass('juno-icon-button');
      expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull(); expect(button.textContent).toBe('');
    }
    const rules = container.querySelector('.juno-rules summary');
    expect(actions).toContainElement(rules as HTMLElement); expect(rules).toHaveClass('juno-icon-button');
    expect(rules?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(within(actions as HTMLElement).getByText('How to play')).toHaveClass('sr-only');
  });
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
    await userEvent.click(screen.getByRole('button', { name: /say juno/i }));
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
  it('keeps the hand visible but disables moves while the confirmed view is stale', () => {
    useJunoStore.setState({ snapshot: { revision: 4, game: game('playing') }, stale: true, error: new RateLimitError(10) });
    render(<JunoTable />);
    expect(screen.getByRole('group', { name: 'Your hand' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /play.*wild/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /say juno/i })).toBeDisabled();
    expect(screen.getByRole('alert')).toBeInTheDocument(); expect(command).not.toHaveBeenCalled();
  });
  it('shows report rules only for a capable host, retaining legacy host rules', async () => {
    const current = game('playing');
    useJunoStore.setState({ snapshot: { revision: 1, game: current } }); render(<JunoTable />);
    await userEvent.click(screen.getByText('How to play'));
    expect(screen.getByText(/otherwise you draw two/i)).toBeInTheDocument();
    useJunoStore.setState({ snapshot: { revision: 2, game: { ...current, supportsReports: true } } });
    expect(await screen.findByText(/another player.*10 seconds/i)).toBeInTheDocument();
    expect(screen.queryByText(/otherwise you draw two/i)).not.toBeInTheDocument();
  });
});
