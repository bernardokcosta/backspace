import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useJunoStore } from '../../stores/junoStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { junoGame } from './junoTestFixtures';
import { JunoMemorySound } from './JunoMemorySound';
const audio = vi.hoisted(() => ({ playSound: vi.fn() }));
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => audio } }));
const target = { accountId: 'a', selfId: 'a', channelId: 'voice', origin: '' };
afterEach(() => vi.useRealTimers());
function cue(id: string, remainingMs = 45_000) {
  const state = useJunoStore.getState();
  useJunoStore.setState({ snapshot: { revision: (state.snapshot?.revision ?? 0) + 1, game: { ...junoGame('playing'), remainingMs,
    lastMove: { id, type: 'play', userId: 'b', targetUserId: 'a', card: { id: 'rare', face: 'memory', color: null } } } } });
}
beforeEach(() => {
  audio.playSound.mockReset(); audio.playSound.mockResolvedValue(null);
  useJunoStore.getState().reset(); useJunoStore.getState().bind(target, true);
  useJunoStore.setState({ snapshot: { revision: 1, game: junoGame('playing') } });
  useVoiceStore.setState({ isDeafened: false, soundEffectVolume: 100, spaceDeafenedUserIds: new Set() });
  useSpaceStore.setState({ spaceChannelIndex: new Map([['voice', { spaceId: 'space', origin: '', type: 'voice' }]]) });
});
describe('Juno confirmed memory audio', () => {
  it.each(['deafened', 'space-deafened', 'zero-volume', 'scope'])('cancels a pending cue on %s without replay', async mode => {
    let resolve!: (source: { stop: () => void }) => void;
    audio.playSound.mockReturnValueOnce(new Promise(res => { resolve = res; }));
    render(<JunoMemorySound target={target} connected />); await act(async () => cue('pending'));
    act(() => {
      if (mode === 'scope') useJunoStore.getState().bind({ ...target, origin: 'https://elsewhere.test' }, true);
      else useVoiceStore.setState({ isDeafened: mode === 'deafened', soundEffectVolume: mode === 'zero-volume' ? 0 : 100,
        spaceDeafenedUserIds: mode === 'space-deafened' ? new Set(['space:a']) : new Set() });
    });
    const stop = vi.fn(); await act(async () => resolve({ stop })); expect(stop).toHaveBeenCalledOnce();
    expect(audio.playSound).toHaveBeenCalledOnce();
  });
  it('discards a load older than three seconds and does not replay on reconnect', async () => {
    vi.useFakeTimers(); let resolve!: (source: { stop: () => void }) => void;
    audio.playSound.mockReturnValueOnce(new Promise(res => { resolve = res; }));
    const view = render(<JunoMemorySound target={target} connected />); await act(async () => cue('late'));
    act(() => vi.advanceTimersByTime(3001)); const stop = vi.fn();
    await act(async () => resolve({ stop })); expect(stop).toHaveBeenCalledOnce();
    view.rerender(<JunoMemorySound target={target} connected={false} />);
    view.rerender(<JunoMemorySound target={target} connected />);
    await act(async () => cue('late')); expect(audio.playSound).toHaveBeenCalledOnce();
  });
  it('plays one new confirmed card through existing SFX and never replays a poll or mount', async () => {
    cue('historical'); render(<JunoMemorySound target={target} connected />); expect(audio.playSound).not.toHaveBeenCalled();
    await act(async () => cue('new'));
    expect(audio.playSound).toHaveBeenCalledExactlyOnceWith('juno_memory', { volume: 0.8 });
    await act(async () => cue('new')); expect(audio.playSound).toHaveBeenCalledTimes(1);
  });
  it.each(['deafened', 'space-deafened', 'zero-volume'])('does not play or defer a cue when %s', async mode => {
    useVoiceStore.setState({ isDeafened: mode === 'deafened', soundEffectVolume: mode === 'zero-volume' ? 0 : 100,
      spaceDeafenedUserIds: mode === 'space-deafened' ? new Set(['space:a']) : new Set() });
    render(<JunoMemorySound target={target} connected />); await act(async () => cue('muted'));
    expect(audio.playSound).not.toHaveBeenCalled();
    act(() => useVoiceStore.setState({ isDeafened: false, soundEffectVolume: 100, spaceDeafenedUserIds: new Set() }));
    await act(async () => cue('muted')); expect(audio.playSound).not.toHaveBeenCalled();
  });
  it('stops an active cue on exit and silences a source whose load completes after exit', async () => {
    const stop = vi.fn(); audio.playSound.mockResolvedValueOnce({ stop });
    const view = render(<JunoMemorySound target={target} connected />); await act(async () => cue('active'));
    view.rerender(<JunoMemorySound target={target} connected={false} />); expect(stop).toHaveBeenCalledTimes(1);
    view.rerender(<JunoMemorySound target={target} connected />);
    let resolve!: (source: { stop: () => void }) => void;
    audio.playSound.mockReturnValueOnce(new Promise(res => { resolve = res; }));
    await act(async () => cue('pending')); view.unmount();
    const lateStop = vi.fn(); await act(async () => resolve({ stop: lateStop })); expect(lateStop).toHaveBeenCalledTimes(1);
  });
  it('ignores stale resume snapshots and audio failure never rejects a game update', async () => {
    render(<JunoMemorySound target={target} connected />); await act(async () => cue('old', 30_000));
    expect(audio.playSound).not.toHaveBeenCalled();
    audio.playSound.mockRejectedValueOnce(new Error('Autoplay denied'));
    await act(async () => cue('fresh')); expect(audio.playSound).toHaveBeenCalledTimes(1);
    expect(useJunoStore.getState().snapshot?.game?.lastMove?.id).toBe('fresh');
  });
});
