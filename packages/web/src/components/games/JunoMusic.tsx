import { useEffect, type RefObject } from 'react';
import { useJunoStore, type JunoTarget } from '../../stores/junoStore';
import { useUIStore } from '../../stores/uiStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useSoundboardStore } from '../../stores/soundboardStore';
import { useScreenShareSetupStore } from '../../stores/screenShareSetupStore';
import { useJunoPreferences } from '../../stores/junoPreferences';
import { createJunoMusicPlayer, useJunoMusicState } from '../../audio/junoMusic';
import { useMobileScreenVisible } from '../layout/MobileScreenVisibility';

/** Real viewport presence, including incoming/outgoing mobile screen animations. */
export function useJunoMusicView(ref: RefObject<HTMLElement | null>, target: JunoTarget | null) {
  const foreground = useMobileScreenVisible();
  useEffect(() => {
    const element = ref.current;
    if (!element || !target || !foreground || typeof IntersectionObserver === 'undefined') return;
    let release: (() => void) | undefined;
    const observer = new IntersectionObserver(entries => {
      const visible = entries.some(entry => entry.target === element && entry.isIntersecting && entry.intersectionRatio >= .99);
      if (visible && !release) release = useJunoStore.getState().presentView(target);
      else if (!visible) { release?.(); release = undefined; }
    }, { threshold: [0, .99, 1] });
    observer.observe(element);
    return () => { observer.disconnect(); release?.(); };
  }, [ref, target, foreground]);
}

/** One owner per voice target; view remounts pause but do not reset its position. */
export function JunoMusic({ target }: { target: JunoTarget | null }) {
  const key = target ? JSON.stringify([target.userId, target.origin, target.channelId]) : '';
  useEffect(() => {
    if (!target || !key) return;
    const owner = target;
    const player = createJunoMusicPlayer(status => useJunoMusicState.setState({ status }));
    let focused = document.hasFocus();
    const update = () => {
      const game = useJunoStore.getState(), ui = useUIStore.getState(), voice = useVoiceStore.getState();
      const channel = useSpaceStore.getState().spaceChannelIndex.get(owner.channelId);
      const current = game.target;
      const gain = .20 * useJunoPreferences.getState().musicVolume / 100 * voice.outputVolume / 100;
      const eligible = !!current && current.userId === owner.userId && current.origin === owner.origin && current.channelId === owner.channelId
        && game.connected && !!game.snapshot && game.open && game.presentedViews.size > 0
        && voice.isLiveKitConnected && voice.voiceConnectionStatus === 'connected' && voice.currentVoiceChannelId === owner.channelId
        && channel?.type === 'voice' && owner.origin === window.location.origin
        && !voice.isDeafened && !voice.spaceDeafenedUserIds.has(`${channel.spaceId}:${owner.userId}`)
        && !ui.activeModal && !useSoundboardStore.getState().open && !useScreenShareSetupStore.getState().isOpen && !voice.incomingCall
        && (!ui.isMobile || ui.mobileStack.at(-1)?.screen === 'voice-full')
        && !ui.voiceChatOpen && document.visibilityState === 'visible' && focused && gain > 0;
      player.update(eligible, gain);
    };
    const blur = () => { focused = false; update(); };
    const focus = () => { focused = true; update(); };
    const focusIn = () => { focused = document.hasFocus(); update(); };
    const retry = () => { focused = document.hasFocus(); update(); player.retry(); };
    useJunoMusicState.setState({ status: 'idle', retry });
    const subscriptions = [useJunoStore.subscribe(update), useUIStore.subscribe(update), useVoiceStore.subscribe(update), useSpaceStore.subscribe(update), useJunoPreferences.subscribe(update), useSoundboardStore.subscribe(update), useScreenShareSetupStore.subscribe(update)];
    window.addEventListener('blur', blur); window.addEventListener('focus', focus); document.addEventListener('focusin', focusIn); document.addEventListener('visibilitychange', update);
    update();
    return () => {
      subscriptions.forEach(unsubscribe => unsubscribe());
      window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); document.removeEventListener('focusin', focusIn); document.removeEventListener('visibilitychange', update);
      player.dispose(); if (useJunoMusicState.getState().retry === retry) useJunoMusicState.setState({ status: 'idle', retry: null });
    };
  }, [key, target]);
  return null;
}
