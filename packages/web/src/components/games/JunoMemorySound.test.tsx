import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useJunoStore } from '../../stores/junoStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { DEFAULT_JUNO_PREFERENCES, useJunoPreferences } from '../../stores/junoPreferences';
import { junoGame } from './junoTestFixtures';
import { JunoMemorySound } from './JunoMemorySound';
const audio = vi.hoisted(() => ({ loadSound: vi.fn(), resumeContext: vi.fn(), createBufferSource: vi.fn(), createGain: vi.fn(), ensureContext: vi.fn(), getMasterOutput: vi.fn() }));
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => audio } }));
const target = { accountId: 'a', selfId: 'a', channelId: 'voice', origin: '' };
const node = { stop: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), start: vi.fn(), buffer: null, onended: null };
const gain = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
afterEach(() => vi.useRealTimers());
function cue(id: string, remainingMs = 45_000) {
  const state = useJunoStore.getState();
  useJunoStore.setState({ snapshot: { revision: (state.snapshot?.revision ?? 0) + 1, game: { ...junoGame('playing'), remainingMs,
    lastMove: { id, type: 'play', userId: 'b', targetUserId: 'a', card: { id: 'rare', face: 'memory', color: null } } } } });
}
beforeEach(() => {
  vi.clearAllMocks(); audio.loadSound.mockReset(); audio.loadSound.mockResolvedValue({ duration: 2.7875 }); audio.resumeContext.mockResolvedValue(undefined);
  audio.createBufferSource.mockReturnValue(node); audio.createGain.mockReturnValue(gain);
  audio.ensureContext.mockReturnValue({ createBufferSource: audio.createBufferSource, createGain: audio.createGain });
  useJunoStore.getState().reset(); useJunoStore.getState().bind(target, true);
  useJunoStore.setState({ snapshot: { revision: 1, game: junoGame('playing') } });
  useJunoPreferences.setState(DEFAULT_JUNO_PREFERENCES);
  useVoiceStore.setState({ isDeafened: false, soundEffectVolume: 100, spaceDeafenedUserIds: new Set() });
  useSpaceStore.setState({ spaceChannelIndex: new Map([['voice', { spaceId: 'space', origin: '', type: 'voice' }]]) });
});
describe('Juno confirmed memory audio', () => {
  it.each(['deafened', 'space-deafened', 'zero-volume', 'local-zero', 'scope'])('cancels a pending cue on %s without creating a late source', async mode => {
    let resolve!: (buffer: object) => void; audio.loadSound.mockReturnValueOnce(new Promise(res => { resolve = res; }));
    render(<JunoMemorySound target={target} connected />); await act(async () => cue('pending'));
    act(() => {
      if (mode === 'scope') useJunoStore.getState().bind({ ...target, origin: 'https://elsewhere.test' }, true);
      else if (mode === 'local-zero') useJunoPreferences.getState().setEffectsVolume(0);
      else useVoiceStore.setState({ isDeafened: mode === 'deafened', soundEffectVolume: mode === 'zero-volume' ? 0 : 100,
        spaceDeafenedUserIds: mode === 'space-deafened' ? new Set(['space:a']) : new Set() });
    });
    await act(async () => resolve({})); expect(audio.createBufferSource).not.toHaveBeenCalled(); expect(audio.loadSound).toHaveBeenCalledOnce();
  });
  it('discards loads older than three seconds and does not replay on reconnect', async () => {
    vi.useFakeTimers(); let resolve!: (buffer: object) => void;
    audio.loadSound.mockReturnValueOnce(new Promise(res => { resolve = res; }));
    const view = render(<JunoMemorySound target={target} connected />); await act(async () => cue('late'));
    act(() => vi.advanceTimersByTime(3001)); await act(async () => resolve({})); expect(audio.createBufferSource).not.toHaveBeenCalled();
    view.rerender(<JunoMemorySound target={target} connected={false} />); view.rerender(<JunoMemorySound target={target} connected />);
    await act(async () => cue('late')); expect(audio.loadSound).toHaveBeenCalledOnce();
  });
  it('plays one confirmed id through the original bus, never a historical mount or poll', async () => {
    cue('historical'); render(<JunoMemorySound target={target} connected />); expect(audio.loadSound).not.toHaveBeenCalled();
    await act(async () => cue('new')); expect(audio.loadSound).toHaveBeenCalledExactlyOnceWith('juno_memory');
    expect(node.start).toHaveBeenCalledOnce(); expect(gain.gain.value).toBe(.8);
    await act(async () => cue('new')); expect(audio.loadSound).toHaveBeenCalledOnce();
  });
  it('changes currently playing local/global SFX gain without replay or changing other audio', async () => {
    render(<JunoMemorySound target={target} connected />); await act(async () => cue('live'));
    act(() => useJunoPreferences.getState().setEffectsVolume(25)); expect(gain.gain.value).toBe(.2);
    act(() => useVoiceStore.setState({ soundEffectVolume: 50 })); expect(gain.gain.value).toBe(.1);
    expect(node.start).toHaveBeenCalledOnce(); expect(useJunoPreferences.getState().musicVolume).toBe(100);
    act(() => useJunoPreferences.getState().setEffectsVolume(0)); expect(node.stop).toHaveBeenCalledOnce();
  });
  it.each(['deafened', 'space-deafened', 'zero-volume', 'local-zero'])('does not defer a cue when %s', async mode => {
    useVoiceStore.setState({ isDeafened: mode === 'deafened', soundEffectVolume: mode === 'zero-volume' ? 0 : 100,
      spaceDeafenedUserIds: mode === 'space-deafened' ? new Set(['space:a']) : new Set() });
    if (mode === 'local-zero') useJunoPreferences.getState().setEffectsVolume(0);
    render(<JunoMemorySound target={target} connected />); await act(async () => cue('muted')); expect(audio.loadSound).not.toHaveBeenCalled();
    act(() => { useVoiceStore.setState({ isDeafened: false, soundEffectVolume: 100, spaceDeafenedUserIds: new Set() }); useJunoPreferences.getState().setEffectsVolume(100); });
    await act(async () => cue('muted')); expect(audio.loadSound).not.toHaveBeenCalled();
  });
  it('stops on exit and ignores a load finishing after unmount', async () => {
    const view = render(<JunoMemorySound target={target} connected />); await act(async () => cue('active'));
    view.rerender(<JunoMemorySound target={target} connected={false} />); expect(node.stop).toHaveBeenCalledOnce();
    view.rerender(<JunoMemorySound target={target} connected />);
    let resolve!: (buffer: object) => void; audio.loadSound.mockReturnValueOnce(new Promise(res => { resolve = res; }));
    await act(async () => cue('pending')); view.unmount(); await act(async () => resolve({})); expect(audio.createBufferSource).toHaveBeenCalledOnce();
  });
  it('ignores stale snapshots and contains load failure', async () => {
    render(<JunoMemorySound target={target} connected />); await act(async () => cue('old', 30_000)); expect(audio.loadSound).not.toHaveBeenCalled();
    audio.loadSound.mockRejectedValueOnce(new Error('Decode failed')); await act(async () => cue('fresh'));
    expect(audio.loadSound).toHaveBeenCalledOnce(); expect(useJunoStore.getState().snapshot?.game?.lastMove?.id).toBe('fresh');
  });
});
