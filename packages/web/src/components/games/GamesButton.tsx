import { useTranslation } from 'react-i18next';
import { useJunoStore } from '../../stores/junoStore';
import { useVoiceStore } from '../../stores/voiceStore';

export function GamesButton({ className = 'w-10 h-10 rounded-full flex items-center justify-center bg-surface-channel text-txt-secondary hover:text-txt-primary' }: { className?: string }) {
  const { t } = useTranslation('voice');
  const target = useJunoStore(s => s.target);
  const connected = useJunoStore(s => s.connected);
  const open = useJunoStore(s => s.open);
  const game = useJunoStore(s => s.snapshot?.game);
  if (!target) return null;
  return <button type="button" className={`${className} relative disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent-primary`}
    disabled={!connected} title={t('juno.games')} aria-label={t('juno.games')} aria-pressed={open}
    onClick={() => { useVoiceStore.getState().setFocusedParticipant(null); useJunoStore.getState().setOpen(!open); }}>
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h10c2 0 3.5 1.5 4 4l1 7c.4 3-2.5 4.2-4.3 2.4L15 16H9l-2.7 2.4C4.5 20.2 1.6 19 2 16l1-7c.5-2.5 2-4 4-4ZM7 8v3H4v2h3v3h2v-3h3v-2H9V8H7Zm9 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm3 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" /></svg>
    {game && <span className="absolute right-0 top-0 w-2 h-2 rounded-full bg-accent-mint" />}
  </button>;
}
