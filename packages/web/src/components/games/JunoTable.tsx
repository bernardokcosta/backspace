import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useJunoStore } from '../../stores/junoStore';
import { describeError } from '../../i18n/errors';
import { JunoLobby } from './JunoLobby';
import { JunoMatch } from './JunoMatch';
import { JunoResult } from './JunoResult';
import { JunoRanking } from './JunoRanking';
import { JUNO_ASSETS } from './junoAssets';
import './juno.css';

export function JunoTable() {
  const { t } = useTranslation(['voice', 'common']);
  const { snapshot, target, connected, pending, stale, error, command } = useJunoStore();
  const game = snapshot?.game; const revision = snapshot?.revision ?? -1;
  const context = target ? `${target.accountId}:${target.origin}:${target.channelId}` : '';
  const leaveContext = `${context}:${game?.id ?? ''}:${revision}`;
  const [leaveKey, setLeaveKey] = useState<string | null>(null);
  const [rankingContext, setRankingContext] = useState<string | null>(null);
  const leaveTrigger = useRef<HTMLButtonElement>(null);
  const rankingOpen = !!target && rankingContext === context;
  const isPlayer = !!game?.players.some(p => p.userId === target?.selfId);
  return <section className="juno-table" aria-label={t('juno.name')}>
    <header className="juno-header">
      <img className="juno-header-logo" src={JUNO_ASSETS.logo} alt={t('juno.name')} />
      {game?.practice && <span className="juno-practice" title={t('juno.practiceHint')}>{t('juno.practice')}</span>}
      <div className="juno-header-actions">
        <details className="juno-rules" onKeyDown={event => { if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus();
        } }}><summary title={t('juno.rules')}><span aria-hidden="true">?</span><span className="sr-only">{t('juno.rules')}</span></summary>
          <div className="juno-rules-content glass"><p>{t('juno.rulesText')}</p>
            <p>{t(game?.supportsReports ? 'juno.reportRules' : 'juno.legacyJunoRules')}</p>{game?.memoryEnabled && <p>{t('juno.memory.rules')}</p>}<p>{t('juno.scoreRules')}</p><p>{t('juno.practiceHint')}</p></div>
        </details>
        {!rankingOpen && game && game.phase !== 'lobby' && <button type="button" className="juno-text-button" aria-label={t('juno.rankingTitle')} title={t('juno.rankingTitle')} onClick={() => setRankingContext(context)}>
          <svg className="juno-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 20V12h4v8m2 0V5h4v15m2 0v-9h4v9" /></svg><span className="juno-action-label">{t('juno.rankingTitle')}</span></button>}
        {isPlayer && <button ref={leaveTrigger} type="button" className="juno-text-button" aria-label={t('juno.leave')} title={t('juno.leave')} onClick={() => setLeaveKey(leaveContext)}>
          <svg className="juno-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M10 4H4v16h6m4-12 4 4-4 4m-6-4h12" /></svg><span className="juno-action-label">{t('juno.leave')}</span></button>}
        <button type="button" className="juno-text-button" aria-label={t('juno.mosaic')} title={t('juno.mosaic')} onClick={() => useJunoStore.getState().setOpen(false)}>
          <svg className="juno-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg><span className="juno-action-label">{t('juno.mosaic')}</span></button>
      </div>
    </header>
    {!connected && <p className="juno-notice" role="status">{t('juno.reconnecting')}</p>}
    {!!error && <div className="juno-error" role="alert"><span>{describeError(error)}</span>
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
