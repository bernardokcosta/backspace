import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useJunoStore, type JunoTarget } from '../../stores/junoStore';
import { describeError } from '../../i18n/errors';
import { JunoLobby } from './JunoLobby';
import { JunoMatch } from './JunoMatch';
import { JunoResult } from './JunoResult';
import { JunoRanking } from './JunoRanking';
import { JUNO_ASSETS } from './junoAssets';
import { JunoLocale, useJunoLanguage } from './JunoLocale';
import { useJunoMusicView } from './JunoMusic';
import { JunoSettings } from './JunoSettings';
import { JunoRules } from './JunoRules';
import './juno.css';

export function JunoTable() {
  return <JunoLocale><JunoTableContent /></JunoLocale>;
}
function JunoTableContent() {
  const { t, i18n } = useTranslation(['voice', 'common']);
  const { snapshot, target, connected, pending, stale, error, command } = useJunoStore();
  const table = useRef<HTMLElement>(null);
  useJunoMusicView(table, target);
  const game = snapshot?.game; const revision = snapshot?.revision ?? -1;
  const context = target ? `${target.userId}:${target.origin}:${target.channelId}` : '';
  const leaveContext = `${context}:${game?.id ?? ''}:${revision}`;
  const [leaveKey, setLeaveKey] = useState<string | null>(null);
  const [rankingContext, setRankingContext] = useState<string | null>(null);
  const leaveTrigger = useRef<HTMLButtonElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const [settingsTarget, setSettingsTarget] = useState<JunoTarget | null>(null);
  const rankingOpen = !!target && rankingContext === context;
  const isPlayer = !!game?.players.some(p => p.userId === target?.userId);
  const { language: gameLanguage, dir: gameDir } = useJunoLanguage();
  return <section ref={table} className="juno-table" aria-label={t('juno.name')} lang={gameLanguage} dir={gameDir}
    onClickCapture={event => {
      if (!(event.target instanceof Element)) return;
      const control = event.target.closest('button,summary');
      if (!control || control.matches(':disabled,[aria-disabled="true"]')) return;
      useJunoStore.getState().playFeedback?.(control.classList.contains('juno-hand-card') ? 'select' : 'button');
    }}>
    <header className="juno-header">
      <div className="juno-header-brand"><img className="juno-header-logo" src={JUNO_ASSETS.logo} alt={t('juno.name')} />
        {game?.practice && <span className="juno-practice" title={t('juno.practiceHint')}>{t('juno.practice')}</span>}</div>
      <div className="juno-header-actions">
        <JunoRules key={context} game={game ?? null} supportsMemory={snapshot?.supportsMemory} />
        {!rankingOpen && game && game.phase !== 'lobby' && <button type="button" className="juno-icon-button glass" aria-label={t('juno.rankingTitle')} title={t('juno.rankingTitle')} onClick={() => setRankingContext(context)}>
          <svg className="juno-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 20V12h4v8m2 0V4h4v16m2 0v-8h4v8M3 20h18" /></svg></button>}
        <button ref={settingsTrigger} type="button" className="juno-icon-button juno-settings-button glass" aria-label={t('juno.settings.title')} title={t('juno.settings.title')} onClick={() => setSettingsTarget(target)}>
          <svg className="juno-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M10 3h4l.6 2.4 1.5 .9 2.4 -.7 2 3.5 -1.8 1.7v2.4l1.8 1.7 -2 3.5 -2.4 -.7 -1.5 .9L14 21h-4l-.6 -2.4 -1.5 -.9 -2.4 .7 -2 -3.5 1.8 -1.7v-2.4l-1.8 -1.7 2 -3.5 2.4 .7 1.5 -.9L10 3Z" /><circle cx="12" cy="12" r="3" /></svg>
        </button>
        {isPlayer && <button ref={leaveTrigger} type="button" className="juno-icon-button glass" aria-label={t('juno.leave')} title={t('juno.leave')} onClick={() => setLeaveKey(leaveContext)}>
          <svg className="juno-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M10 4H4v16h6m4-12 4 4-4 4m-6-4h12" /></svg></button>}
        <button type="button" className="juno-icon-button glass" aria-label={t('juno.mosaic')} title={t('juno.mosaic')} onClick={() => useJunoStore.getState().setOpen(false)}>
          <svg className="juno-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg></button>
      </div>
    </header>
    {!!target && settingsTarget === target && <JunoSettings trigger={settingsTrigger} onClose={() => setSettingsTarget(null)} />}
    {!connected && <p className="juno-notice" role="status">{t('juno.reconnecting')}</p>}
    {!!error && <div className="juno-error" role="alert"><span>{describeError(error, i18n)}</span>
      <button type="button" className="juno-text-button" onClick={() => void useJunoStore.getState().load()}>{t('common:actions.retry')}</button></div>}
    {leaveKey === leaveContext && isPlayer && <div className="juno-notice glass" role="group" aria-label={t('juno.leaveConfirm')}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); setLeaveKey(null); leaveTrigger.current?.focus(); } }}>
      <span>{t('juno.leaveConfirm')}</span>
      <button type="button" className="juno-text-button" disabled={!connected || pending || stale} onClick={() => {
        const current = useJunoStore.getState();
        if (current.target === target && current.snapshot?.revision === revision && current.snapshot.game?.id === game?.id) void command({ type: 'leave' });
        setLeaveKey(null);
      }}>{t('juno.leave')}</button>
      <button type="button" autoFocus className="juno-text-button" onClick={() => { setLeaveKey(null); leaveTrigger.current?.focus(); }}>{t('common:actions.cancel')}</button>
    </div>}
    <div className="juno-content">{rankingOpen ? <JunoRanking key={context} onBack={() => setRankingContext(null)} />
      : !game || game.phase === 'lobby' ? <JunoLobby onRanking={() => setRankingContext(context)} />
        : game.phase === 'finished' ? <JunoResult /> : <JunoMatch key={`${context}:${game.id}`} />}</div>
  </section>;
}
