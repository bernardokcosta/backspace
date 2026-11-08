import { create } from 'zustand';
import { AudioManager } from './AudioManager';
import { JUNO_MUSIC_URL } from '../components/games/junoAssets';

export type JunoMusicStatus = 'idle' | 'playing' | 'blocked' | 'error';
/** Playback feedback only, not persisted and not a second navigation/focus store. */
export const useJunoMusicState = create<{ status: JunoMusicStatus; retry: (() => void) | null }>(() => ({ status: 'idle', retry: null }));
interface Output {
  resumeContext: () => Promise<void>;
  ensureContext: () => AudioContext;
  getMasterOutput: () => AudioNode;
}
interface Dependencies { manager: () => Output; createMedia: () => HTMLAudioElement }

/** One lazily streamed track. A zero gain guards every asynchronous start. */
export function createJunoMusicPlayer(report: (status: JunoMusicStatus) => void,
  dependencies: Dependencies = { manager: () => AudioManager.getInstance(), createMedia: () => new Audio() }) {
  let media: HTMLAudioElement | null = null, gain: GainNode | null = null, source: MediaElementAudioSourceNode | null = null;
  let output: Output | null = null, active = false, disposed = false, playing = false, failed = false;
  let volume = 0, generation = 0, pending = false, wired = false, status: JunoMusicStatus = 'idle';
  const setStatus = (next: JunoMusicStatus) => { if (!disposed && status !== next) { status = next; report(next); } };
  const pause = () => { if (gain) gain.gain.value = 0; media?.pause(); playing = false; };
  const releaseMedia = () => {
    pause(); media?.removeEventListener('error', onError); media?.removeAttribute('src'); media?.load();
    source?.disconnect(); gain?.disconnect(); media = null; source = null; gain = null; output = null; wired = false;
  };
  const onError = () => { if (!disposed) { generation++; failed = true; pause(); setStatus('error'); } };
  async function start(fromGesture = false) {
    if (!active || disposed || pending || playing || failed) return;
    pending = true; const attempt = generation;
    try {
      if (!media) {
        output = dependencies.manager();
        const context = output.ensureContext();
        media = dependencies.createMedia(); media.loop = true; media.preload = 'none'; media.src = JUNO_MUSIC_URL;
        media.addEventListener('error', onError);
        gain = context.createGain(); gain.gain.value = 0;
        source = context.createMediaElementSource(media); source.connect(gain); gain.connect(output.getMasterOutput());
        wired = true;
      }
      // Chromium can leave resume() pending forever before the first gesture.
      // Surface a real retry instead of waiting silently with no usable control.
      if (!fromGesture && output!.ensureContext().state === 'suspended' && !navigator.userActivation?.hasBeenActive) {
        throw new DOMException('A playback gesture is required', 'NotAllowedError');
      }
      await output!.resumeContext();
      if (!active || disposed || attempt !== generation) return;
      await media.play();
      if (!active || disposed || attempt !== generation) { pause(); return; }
      playing = true; gain!.gain.value = volume; setStatus('playing');
    } catch (error) {
      if (!wired) releaseMedia();
      if (!disposed && active && attempt === generation) {
        failed = true; pause(); setStatus(error instanceof DOMException && error.name === 'NotAllowedError' ? 'blocked' : 'error');
      }
    } finally {
      pending = false;
      if (!disposed && active && !playing && !failed && attempt !== generation) void start();
    }
  }
  return {
    update(eligible: boolean, nextVolume: number) {
      if (disposed) return;
      volume = Number.isFinite(nextVolume) ? Math.max(0, Math.min(1, nextVolume)) : 0;
      const nextActive = eligible && volume > 0;
      if (!nextActive) {
        if (active) generation++;
        active = false; pause(); if (!failed) setStatus('idle'); return;
      }
      active = true;
      if (playing && gain) gain.gain.value = volume;
      else void start();
    },
    retry() {
      if (!active || disposed) return;
      // A failed resource remains errored until load() reruns media selection.
      // Keep the same routed element; abort/invalidate any old pending play.
      if (media?.error) { generation++; pause(); media.load(); }
      failed = false; void start(true);
    },
    dispose() {
      if (disposed) return;
      disposed = true; active = false; generation++; releaseMedia();
    },
  };
}
