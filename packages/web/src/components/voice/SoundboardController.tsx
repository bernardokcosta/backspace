import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { SoundboardLibrary } from './SoundboardLibrary';
import { useVoiceStore } from '../../stores/voiceStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useAuthStore } from '../../stores/authStore';
import { canPlaySoundboard, useSoundboardStore, useSoundboardPreferences, soundboardKey } from '../../stores/soundboardStore';
import { stopSoundboardPlayback, updateSoundboardVolume } from '../../audio/soundboardPlayback';
import { shortcutFromEvent, sameShortcut, conflictsWithVoiceShortcut } from '../../utils/soundboardShortcuts';
import { useUIStore } from '../../stores/uiStore';
import { describeError } from '../../i18n/errors';

export function SoundboardController() {
  const { t } = useTranslation('voice');
  const userId = useAuthStore(s => s.user?.id);
  const sessionRevision = useAuthStore(s => s.sessionRevision);
  const channelId = useVoiceStore(s => s.currentVoiceChannelId);
  const connected = useVoiceStore(s => s.isLiveKitConnected);
  const deafened = useVoiceStore(s => s.isDeafened);
  const spaceDeafened = useVoiceStore(s => s.spaceDeafenedUserIds);
  const outputVolume = useVoiceStore(s => s.outputVolume);
  const volume = useSoundboardPreferences(s => s.volume);
  const spaceId = useSpaceStore(s => channelId ? s.channelToSpaceMap.get(channelId) : undefined);
  const open = useSoundboardStore(s => s.open);
  const load = useSoundboardStore(s => s.load);
  const previousUser = useRef(userId);
  useEffect(() => {
    if (previousUser.current !== userId) { useSoundboardStore.getState().reset(); stopSoundboardPlayback(); }
    previousUser.current = userId;
  }, [userId]);
  useEffect(() => {
    if (userId && spaceId && connected) void load(spaceId);
    useSoundboardStore.getState().setOpen(false);
    stopSoundboardPlayback();
    return stopSoundboardPlayback;
  }, [userId, sessionRevision, channelId, spaceId, connected, load]);
  useEffect(() => {
    if (deafened || spaceDeafened.has(`${spaceId}:${userId}`)) stopSoundboardPlayback();
  }, [deafened, spaceDeafened, spaceId, userId]);
  useEffect(updateSoundboardVolume, [volume, outputVolume]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.repeat || event.defaultPrevented || event.isComposing || !(event.target instanceof HTMLElement)
        || event.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      const voice = useVoiceStore.getState();
      const channel = voice.currentVoiceChannelId;
      const space = channel ? useSpaceStore.getState().channelToSpaceMap.get(channel) : undefined;
      if (!userId || !channel || !space || !voice.isLiveKitConnected || voice.isDeafened) return;
      if (sessionRevision !== useAuthStore.getState().sessionRevision || !canPlaySoundboard(space, channel, voice)) return;
      const shortcut = shortcutFromEvent(event);
      if (!shortcut || conflictsWithVoiceShortcut(shortcut)) return;
      const key = soundboardKey(space);
      const document = useSoundboardStore.getState().entries[key]?.document;
      if (!document?.settings.enabled) return;
      const prefs = useSoundboardPreferences.getState();
      const sound = document.sounds.find(s => {
        const binding = prefs.shortcuts[`${key}:${s.id}`];
        return binding !== undefined && sameShortcut(binding, shortcut);
      });
      if (!sound || sound.durationSeconds > document.settings.maxDurationSeconds) return;
      event.preventDefault();
      void useSoundboardStore.getState().play(space, sound.id, channel).catch(cause => {
        if (sessionRevision === useAuthStore.getState().sessionRevision) useUIStore.getState().addToast(describeError(cause), 'warning');
      });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [userId, sessionRevision]);
  return <Modal isOpen={open && !!spaceId && !!channelId && connected} onClose={() => useSoundboardStore.getState().setOpen(false)} maxWidth="max-w-2xl" mobileStyle="sheet">
    {spaceId && channelId && <SoundboardDialog key={`${sessionRevision}:${spaceId}:${channelId}`} title={t('soundboard.title')} spaceId={spaceId} channelId={channelId} />}
  </Modal>;
}

function SoundboardDialog({ title, spaceId, channelId }: { title: string; spaceId: string; channelId: string }) {
  const { t } = useTranslation('common');
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    dialog?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
        .filter(element => element.getClientRects().length > 0);
      const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', trap, true);
    return () => { document.removeEventListener('keydown', trap, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="outline-none">
    <div className="flex justify-between items-center mb-4 gap-3">
      <h2 id={titleId} className="text-xl font-semibold text-txt-primary">{title}</h2>
      <button type="button" onClick={() => useSoundboardStore.getState().setOpen(false)} aria-label={t('actions.close')} className="w-10 h-10 rounded-full text-txt-tertiary hover:text-txt-primary hover:bg-interactive-hover">×</button>
    </div>
    <SoundboardLibrary spaceId={spaceId} channelId={channelId} />
  </div>;
}
