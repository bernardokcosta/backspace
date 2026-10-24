import { useTranslation } from 'react-i18next';
import { useVoiceStore } from '../../stores/voiceStore';
import { useSoundboardStore } from '../../stores/soundboardStore';

/**
 * The default matches the VoiceControlBar siblings (round 40px buttons).
 * Callers in differently shaped bars (VoiceControls' rectangular row,
 * MobileVoiceFullScreen) pass their own `className`. The glyph is a solid
 * fill like every other bar icon — never an outline style.
 */
const DEFAULT_CLASSNAME =
  'w-10 h-10 flex items-center justify-center rounded-full transition-colors ' +
  'bg-surface-channel text-txt-secondary hover:bg-surface-elevated hover:text-txt-primary';

export function SoundboardButton({ className = DEFAULT_CLASSNAME }: { className?: string }) {
  const { t } = useTranslation('voice');
  const channelId = useVoiceStore(s => s.currentVoiceChannelId);
  const connected = useVoiceStore(s => s.isLiveKitConnected);
  const open = useSoundboardStore(s => s.open);
  if (!channelId) return null;
  return <button type="button" disabled={!connected} onClick={() => useSoundboardStore.getState().setOpen(true)}
    className={`${className} disabled:opacity-40`} title={t('soundboard.title')} aria-label={t('soundboard.title')} aria-haspopup="dialog" aria-expanded={open}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 20h4V4h-4v16zm-6 0h4v-7H4v7zM16 9v11h4V9h-4z" />
    </svg>
  </button>;
}
