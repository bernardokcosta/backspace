import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useJunoStore } from '../../stores/junoStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { DEFAULT_JUNO_PREFERENCES, useJunoPreferences } from '../../stores/junoPreferences';
import { junoGame } from './junoTestFixtures';
import { JunoSounds as JunoMemorySound } from './JunoSounds';
import { HttpError } from '../../api/client';
import { JUNO_SOUNDS } from './junoSoundCues';
const audio = vi.hoisted(() => ({ loadSound: vi.fn(), resumeContext: vi.fn(), createBufferSource: vi.fn(), createGain: vi.fn(), ensureContext: vi.fn(), getMasterOutput: vi.fn() }));
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => audio } }));
const target = { accountId: 'a', selfId: 'a', channelId: 'voice', origin: '' };
const node = { stop: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), start: vi.fn(), buffer: null, onended: null };
const gain = { gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
afterEach(() => vi.useRealTimers());
function cue(id: string, remainingMs = 45_000) {
  const state = useJunoStore.getState();
  useJunoStore.setState({ snapshot: { revision: (state.snapshot?.revision ?? 0) + 1, game: { ...junoGame('playing'), remainingMs,
    lastMove: { id, type: 'play', userId: 'b', targetUserId: 'a', card: { id: 'rare', face: 'memory', color: null } } } } });
}
beforeEach(() => {
  vi.clearAllMocks(); audio.loadSound.mockReset(); audio.loadSound.mockResolvedValue({ duration: 2.7875 }); audio.resumeContext.mockResolvedValue(undefined);
  audio.createBufferSource.mockReturnValue(node); audio.createGain.mockReturnValue(gain);
  audio.ensureContext.mockReturnValue({ state: 'running', currentTime: 0, createBufferSource: audio.createBufferSource, createGain: audio.createGain });
  useJunoStore.getState().reset(); useJunoStore.getState().bind(target, true);
  useJunoStore.setState({ snapshot: { revision: 1, game: junoGame('playing') } });
  useJunoPreferences.setState(DEFAULT_JUNO_PREFERENCES);
  useVoiceStore.setState({ isDeafened: false, soundEffectVolume: 100, spaceDeafenedUserIds: new Set(),
    isLiveKitConnected: true, voiceConnectionStatus: 'connected', currentVoiceChannelId: 'voice' });
  useSpaceStore.setState({ spaceChannelIndex: new Map([['voice', { spaceId: 'space', origin: '', type: 'voice' }]]) });
});

describe('Juno neon session playback', () => {
  function move(type: 'draw' | 'announce' | 'report' | 'start' = 'draw', id = type) {
    const state = useJunoStore.getState();
    useJunoStore.setState({ snapshot: { revision: state.snapshot!.revision + 1, game: { ...junoGame('playing'), remainingMs: 45_000,
      lastMove: { id, type, userId: 'b', amount: 2 } } } });
  }
  it('uses the same volume controls for pack cues and local interactions', async () => {
    render(<JunoMemorySound target={target} connected />);
    await act(async () => move());
    expect(audio.loadSound).toHaveBeenLastCalledWith('juno/carta_comprada'); expect(gain.gain.value).toBeCloseTo(.8 * .65);
    act(() => useJunoPreferences.getState().setEffectsVolume(25)); expect(gain.gain.value).toBeCloseTo(.8 * .65 * .25);
    await act(async () => useJunoStore.getState().playFeedback?.('select'));
    expect(audio.loadSound).toHaveBeenLastCalledWith('juno/selecionar_carta'); expect(gain.gain.value).toBeCloseTo(.8 * .35 * .25);
    expect(useJunoPreferences.getState().musicVolume).toBe(100);
  });
  it('retains local feedback when the parent binds the target after child effects', async () => {
    useJunoStore.getState().reset();
    render(<JunoMemorySound target={target} connected />);
    act(() => { useJunoStore.getState().bind(target, true); useJunoStore.setState({ snapshot: { revision: 1, game: junoGame() } }); });
    expect(useJunoStore.getState().playFeedback).toBeTypeOf('function');
    await act(async () => useJunoStore.getState().playFeedback?.('button'));
    expect(audio.loadSound).toHaveBeenCalledExactlyOnceWith('juno/botao');
  });
  it('replaces a pending interface cue and never lets its older load start later', async () => {
    let resolve!: (buffer: object) => void;
    audio.loadSound.mockReturnValueOnce(new Promise(res => { resolve = res; }));
    render(<JunoMemorySound target={target} connected />);
    await act(async () => useJunoStore.getState().playFeedback?.('button'));
    await act(async () => useJunoStore.getState().playFeedback?.('select'));
    expect(node.start).toHaveBeenCalledOnce();
    await act(async () => resolve({ duration: .21 })); expect(node.start).toHaveBeenCalledOnce();
  });
  it.each(['disconnect', 'snapshot', 'stale', 'channel', 'unmount'])('cancels pending pack audio on %s', async mode => {
    let resolve!: (buffer: object) => void;
    audio.loadSound.mockReturnValueOnce(new Promise(res => { resolve = res; }));
    const view = render(<JunoMemorySound target={target} connected />); await act(async () => move());
    act(() => {
      if (mode === 'disconnect') useJunoStore.setState({ connected: false });
      if (mode === 'snapshot') useJunoStore.setState({ snapshot: null });
      if (mode === 'stale') useJunoStore.setState({ stale: true });
      if (mode === 'channel') useVoiceStore.setState({ currentVoiceChannelId: 'different' });
      if (mode === 'unmount') view.unmount();
    });
    await act(async () => resolve({ duration: .48 })); expect(node.start).not.toHaveBeenCalled();
  });
  it('consumes silent pack ids, retains microphone-muted playback and suppresses reconnect history', async () => {
    const view = render(<JunoMemorySound target={target} connected />);
    act(() => useJunoPreferences.getState().setEffectsVolume(0)); await act(async () => move());
    act(() => useJunoPreferences.getState().setEffectsVolume(100)); await act(async () => move());
    expect(audio.loadSound).not.toHaveBeenCalled();
    act(() => useVoiceStore.setState({ isMuted: true })); await act(async () => move('announce'));
    expect(audio.loadSound).toHaveBeenCalledExactlyOnceWith('juno/uno');
    view.rerender(<JunoMemorySound target={target} connected={false} />);
    view.rerender(<JunoMemorySound target={target} connected />); await act(async () => move('announce'));
    expect(audio.loadSound).toHaveBeenCalledOnce();
  });
  it('plays invalid feedback only for a new game refusal, never historical or network errors', async () => {
    useJunoStore.setState({ error: new HttpError(400, 'invalid', undefined, 'juno_invalid_move') });
    render(<JunoMemorySound target={target} connected />); expect(audio.loadSound).not.toHaveBeenCalled();
    await act(async () => useJunoStore.setState({ error: new Error('Network error') })); expect(audio.loadSound).not.toHaveBeenCalled();
    await act(async () => useJunoStore.setState({ error: new HttpError(400, 'invalid', undefined, 'juno_invalid_move') }));
    expect(audio.loadSound).toHaveBeenCalledExactlyOnceWith('juno/jogada_invalida');
    await act(async () => useJunoStore.setState({ pending: false })); expect(audio.loadSound).toHaveBeenCalledOnce();
  });
  it('sounds a new result once and ignores an initial result and scoreboard-only updates', async () => {
    const finish = { ...junoGame('finished'), remainingMs: 0, winnerId: 'a', lastMove: { id: 'finish', type: 'play' as const, userId: 'a', card: { id: 'card', face: '8' as const, color: 'sky' as const } } };
    render(<JunoMemorySound target={target} connected />);
    await act(async () => useJunoStore.setState({ snapshot: { revision: 2, game: finish } }));
    expect(audio.loadSound).toHaveBeenCalledExactlyOnceWith('juno/vitoria');
    await act(async () => useJunoStore.setState({ snapshot: { revision: 3, game: { ...finish, scoreboard: { roundId: 'game', status: 'credited', standings: [] } } } }));
    expect(audio.loadSound).toHaveBeenCalledOnce();
  });
  it('never plays a historical finished view or a spectator result', async () => {
    const finish = { ...junoGame('finished'), remainingMs: 0, winnerId: 'a', lastMove: { id: 'finish', type: 'play' as const, userId: 'a' } };
    useJunoStore.setState({ snapshot: { revision: 2, game: finish } });
    const view = render(<JunoMemorySound target={target} connected />);
    await act(async () => useJunoStore.setState({ snapshot: { revision: 3, game: finish } }));
    expect(audio.loadSound).not.toHaveBeenCalled(); view.unmount();
    const spectator = { ...target, selfId: 'spectator' };
    useJunoStore.getState().bind(spectator, true);
    useJunoStore.setState({ snapshot: { revision: 1, game: junoGame('playing') } });
    render(<JunoMemorySound target={spectator} connected />);
    await act(async () => useJunoStore.setState({ snapshot: { revision: 2, game: finish } }));
    expect(audio.loadSound).not.toHaveBeenCalled();
  });
  it('bounds each lane, updates independent live gains and stops all on silence', async () => {
    const nodes = Array.from({ length: 4 }, () => ({ ...node, start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), connect: vi.fn() }));
    const gains = Array.from({ length: 8 }, () => ({ ...gain, gain: { ...gain.gain, value: 0 } }));
    let n = 0, g = 0;
    audio.createBufferSource.mockImplementation(() => nodes[n++]); audio.createGain.mockImplementation(() => gains[g++]);
    render(<JunoMemorySound target={target} connected />);
    await act(async () => move('draw')); await act(async () => move('announce'));
    await act(async () => useJunoStore.getState().playFeedback?.('button'));
    expect(n).toBe(3); expect(nodes[0].stop).not.toHaveBeenCalled();
    act(() => useJunoPreferences.getState().setEffectsVolume(50));
    expect(gains[0].gain.value).toBeCloseTo(.4 * JUNO_SOUNDS.draw.gain);
    expect(gains[2].gain.value).toBeCloseTo(.4 * JUNO_SOUNDS.announce.gain);
    expect(gains[4].gain.value).toBeCloseTo(.4 * JUNO_SOUNDS.button.gain);
    await act(async () => useJunoStore.getState().playFeedback?.('select'));
    expect(nodes[2].stop).toHaveBeenCalledOnce(); expect(nodes[0].stop).not.toHaveBeenCalled();
    act(() => useVoiceStore.setState({ isDeafened: true }));
    for (const source of nodes) expect(source.stop).toHaveBeenCalledOnce();
  });
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
