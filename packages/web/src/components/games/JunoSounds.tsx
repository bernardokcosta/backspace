import { useEffect } from 'react';
import type { JunoView } from '@veyvox/shared/src/juno';
import { AudioManager } from '../../audio/AudioManager';
import { useJunoStore, type JunoTarget } from '../../stores/junoStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { getSfxVolume } from '../../utils/sfx';
import { useJunoPreferences } from '../../stores/junoPreferences';
import { JUNO_DUBBINGS, resolveJunoDubbing } from './junoAssets';
import appI18n from '../../i18n';
import { HttpError } from '../../api/client';
import { JUNO_SOUNDS, junoMoveSounds, type JunoSoundCue, type JunoSoundLane } from './junoSoundCues';

const scopeKey = (target: JunoTarget | null) => target ? JSON.stringify([target.accountId, target.origin, target.channelId, target.selfId]) : '';
function silent(target: JunoTarget): boolean {
  const voice = useVoiceStore.getState();
  const channel = useSpaceStore.getState().spaceChannelIndex.get(target.channelId);
  return voice.isDeafened || getSfxVolume() <= 0 || useJunoPreferences.getState().effectsVolume <= 0
    || !channel || channel.origin !== target.origin || voice.spaceDeafenedUserIds.has(`${channel.spaceId}:${target.selfId}`);
}

/** One session owner for every short Juno cue, never published to voice. */
export function JunoSounds({ target, connected }: { target: JunoTarget | null; connected: boolean }) {
  const key = scopeKey(target);
  useEffect(() => {
    if (!key || !connected) return;
    let alive = true;
    let previous: JunoView | null = null;
    let seenError = useJunoStore.getState().error;
    interface PlayingCue { source?: AudioBufferSourceNode; gain?: GainNode; envelope?: GainNode; scale: number }
    const lanes = new Map<JunoSoundLane, PlayingCue>();
    const volume = () => getSfxVolume() * useJunoPreferences.getState().effectsVolume / 100;
    const valid = () => {
      const state = useJunoStore.getState(), voice = useVoiceStore.getState();
      return alive && scopeKey(state.target) === key && state.connected && !!state.snapshot && !state.stale
        && voice.isLiveKitConnected && voice.voiceConnectionStatus === 'connected'
        && voice.currentVoiceChannelId === state.target?.channelId && !!state.target && !silent(state.target);
    };
    const stopLane = (lane: JunoSoundLane) => {
      const cue = lanes.get(lane); lanes.delete(lane);
      try { cue?.source?.stop(); } catch { /* A source may already have ended. */ }
      cue?.source?.disconnect(); cue?.gain?.disconnect(); cue?.envelope?.disconnect();
    };
    const stop = () => { for (const lane of lanes.keys()) stopLane(lane); };
    const play = (name: JunoSoundCue) => {
      if (!valid()) return;
      const definition = JUNO_SOUNDS[name], lane = definition.lane;
      stopLane(lane);
      const attempt: PlayingCue = { scale: definition.gain };
      lanes.set(lane, attempt);
      const started = Date.now(), manager = AudioManager.getInstance();
      void (async () => {
        await manager.resumeContext();
        if (!valid() || lanes.get(lane) !== attempt || Date.now() - started > 3_000) return;
        let sound: string = definition.sound;
        if (name === 'memory') {
          const preferences = useJunoPreferences.getState();
          const language = preferences.language === 'auto' ? appI18n.resolvedLanguage ?? appI18n.language : preferences.language;
          sound = JUNO_DUBBINGS[resolveJunoDubbing(preferences.dubbingLanguage, language)].memorySound;
        }
        const buffer = await manager.loadSound(sound);
        if (!valid() || lanes.get(lane) !== attempt || Date.now() - started > 3_000 || !buffer) return;
        const context = manager.ensureContext();
        if (context.state !== 'running') return;
        const node = context.createBufferSource(), gain = context.createGain(), envelope = context.createGain();
        attempt.source = node; attempt.gain = gain; attempt.envelope = envelope;
        node.buffer = buffer; gain.gain.value = volume() * attempt.scale;
        const now = context.currentTime, fade = Math.min(.01, buffer.duration / 2);
        envelope.gain.setValueAtTime(0, now);
        envelope.gain.linearRampToValueAtTime(1, now + fade);
        envelope.gain.setValueAtTime(1, now + buffer.duration - fade);
        envelope.gain.linearRampToValueAtTime(0, now + buffer.duration);
        node.connect(envelope); envelope.connect(gain); gain.connect(manager.getMasterOutput());
        node.onended = () => {
          node.disconnect(); gain.disconnect(); envelope.disconnect();
          if (lanes.get(lane) === attempt) lanes.delete(lane);
        };
        node.start();
      })().catch(() => {
        if (lanes.get(lane) === attempt) stopLane(lane);
        // Audio/autoplay failure must never reject a game update or interaction.
      });
    };
    const update = () => {
      const state = useJunoStore.getState();
      if (scopeKey(state.target) !== key || !state.connected) { stop(); previous = null; seenError = state.error; return; }
      const game = state.snapshot?.game;
      if (!game || state.stale) { stop(); previous = null; }
      if (state.error !== seenError) {
        seenError = state.error;
        if (state.error instanceof HttpError && state.error.code === 'juno_invalid_move') play('invalid');
      }
      if (!game || state.stale) return;
      const before = previous; previous = game;
      if (!before || before.id !== game.id) { stop(); return; }
      const cues = junoMoveSounds(before, game, state.target!.selfId);
      if (cues.includes('victory') || cues.includes('defeat')) stop();
      for (const cue of cues) play(cue);
    };
    const unsubscribeGame = useJunoStore.subscribe(update);
    const updateVolume = () => {
      if (!valid()) stop();
      else for (const cue of lanes.values()) if (cue.gain) cue.gain.gain.value = volume() * cue.scale;
    };
    const unsubscribeVoice = useVoiceStore.subscribe(updateVolume);
    const unsubscribePreferences = useJunoPreferences.subscribe(updateVolume);
    const unsubscribeSpace = useSpaceStore.subscribe(updateVolume);
    const feedback = (cue: 'button' | 'select') => play(cue);
    useJunoStore.setState({ playFeedback: feedback });
    update();
    return () => {
      alive = false; stop(); unsubscribeGame(); unsubscribeVoice(); unsubscribePreferences(); unsubscribeSpace();
      if (useJunoStore.getState().playFeedback === feedback) useJunoStore.setState({ playFeedback: null });
    };
  }, [key, connected]);
  return null;
}
