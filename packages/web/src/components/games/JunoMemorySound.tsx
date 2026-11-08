import { useEffect } from 'react';
import { JUNO_TURN_MS } from '@backspace/shared/src/juno';
import { AudioManager } from '../../audio/AudioManager';
import { useJunoStore, type JunoTarget } from '../../stores/junoStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { getSfxVolume } from '../../utils/sfx';
import { useJunoPreferences } from '../../stores/junoPreferences';
import { JUNO_DUBBINGS, resolveJunoDubbing } from './junoAssets';
import appI18n from '../../i18n';

const scopeKey = (target: JunoTarget | null) => target ? JSON.stringify([target.accountId, target.origin, target.channelId, target.selfId]) : '';
function silent(target: JunoTarget): boolean {
  const voice = useVoiceStore.getState();
  const channel = useSpaceStore.getState().spaceChannelIndex.get(target.channelId);
  return voice.isDeafened || getSfxVolume() <= 0 || useJunoPreferences.getState().effectsVolume <= 0
    || !channel || channel.origin !== target.origin || voice.spaceDeafenedUserIds.has(`${channel.spaceId}:${target.selfId}`);
}

/** One session owner, independent of table focus; never publishes audio to voice. */
export function JunoMemorySound({ target, connected }: { target: JunoTarget | null; connected: boolean }) {
  const key = scopeKey(target);
  useEffect(() => {
    if (!key || !connected) return;
    let alive = true, initialized = false, generation = 0;
    let seen: string | undefined;
    let source: AudioBufferSourceNode | null = null;
    let gain: GainNode | null = null;
    const volume = () => getSfxVolume() * useJunoPreferences.getState().effectsVolume / 100;
    const stop = () => { generation++; try { source?.stop(); } catch { /* A source may already have ended. */ } source?.disconnect(); gain?.disconnect(); source = null; gain = null; };
    const update = () => {
      const state = useJunoStore.getState();
      if (scopeKey(state.target) !== key || !state.connected) { stop(); initialized = false; return; }
      const game = state.snapshot?.game;
      if (!game) { stop(); initialized = false; seen = undefined; return; }
      const move = game.lastMove;
      if (!initialized) { initialized = true; seen = move?.id; return; }
      if (!move?.id || move.id === seen) return;
      seen = move.id;
      // remainingMs is already server-relative; a delayed visibility/poll read
      // must not turn an old special card into a newly played clip.
      if (move.type !== 'play' || move.card?.face !== 'memory' || game.remainingMs < JUNO_TURN_MS - 3_000
          || !state.target || silent(state.target)) return;
      stop(); const attempt = generation, started = Date.now();
      const manager = AudioManager.getInstance();
      void (async () => {
        await manager.resumeContext();
        const preferences = useJunoPreferences.getState();
        const language = preferences.language === 'auto' ? appI18n.resolvedLanguage ?? appI18n.language : preferences.language;
        const edition = resolveJunoDubbing(preferences.dubbingLanguage, language);
        const buffer = await manager.loadSound(JUNO_DUBBINGS[edition].memorySound);
        const current = useJunoStore.getState();
        if (!alive || attempt !== generation || scopeKey(current.target) !== key || !current.target
            || !current.connected || silent(current.target) || Date.now() - started > 3_000 || !buffer) return;
        const context = manager.ensureContext(), node = context.createBufferSource(), nodeGain = context.createGain();
        node.buffer = buffer; nodeGain.gain.value = volume();
        node.connect(nodeGain); nodeGain.connect(manager.getMasterOutput());
        node.onended = () => { node.disconnect(); nodeGain.disconnect(); if (source === node) { source = null; gain = null; } };
        source = node; gain = nodeGain; node.start();
      })().catch(() => { /* Sound failure must never reject a game update. */ });
    };
    const unsubscribeGame = useJunoStore.subscribe(update);
    const updateVolume = () => {
      const current = useJunoStore.getState();
      if (!current.target || silent(current.target)) stop();
      else if (gain) gain.gain.value = volume();
    };
    const unsubscribeVoice = useVoiceStore.subscribe(updateVolume);
    const unsubscribePreferences = useJunoPreferences.subscribe(updateVolume);
    const unsubscribeSpace = useSpaceStore.subscribe(updateVolume);
    update();
    return () => { alive = false; stop(); unsubscribeGame(); unsubscribeVoice(); unsubscribePreferences(); unsubscribeSpace(); };
  }, [key, connected]);
  return null;
}
