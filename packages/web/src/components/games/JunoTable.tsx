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
  const { snapshot, target, connected, pending, error, command } = useJunoStore();
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
      <div className="juno-header-actions">
        {!rankingOpen && game && game.phase !== 'lobby' && <button type="button" className="juno-text-button" onClick={() => setRankingContext(context)}>{t('juno.rankingTitle')}</button>}
        {isPlayer && <button ref={leaveTrigger} type="button" className="juno-text-button" onClick={() => setLeaveKey(leaveContext)}>{t('juno.leave')}</button>}
        <button type="button" className="juno-text-button" onClick={() => useJunoStore.getState().setOpen(false)}>{t('juno.mosaic')}</button>
      </div>
    </header>
    {!connected && <p className="juno-notice" role="status">{t('juno.reconnecting')}</p>}
    {!!error && <div className="juno-error" role="alert"><span>{describeError(error)}</span>
      <button type="button" className="juno-text-button" onClick={() => void useJunoStore.getState().load()}>{t('common:actions.retry')}</button></div>}
    {leaveKey === leaveContext && isPlayer && <div className="juno-notice glass" role="group" aria-label={t('juno.leaveConfirm')}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); setLeaveKey(null); leaveTrigger.current?.focus(); } }}>
      <span>{t('juno.leaveConfirm')}</span>
      <button type="button" className="juno-text-button" disabled={!connected || pending} onClick={() => {
        const current = useJunoStore.getState();
        if (current.target === target && current.snapshot?.revision === revision && current.snapshot.game?.id === game?.id) void command({ type: 'leave' });
        setLeaveKey(null);
      }}>{t('juno.leave')}</button>
      <button type="button" autoFocus className="juno-text-button" onClick={() => { setLeaveKey(null); leaveTrigger.current?.focus(); }}>{t('common:actions.cancel')}</button>
    </div>}
    {rankingOpen ? <JunoRanking key={context} onBack={() => setRankingContext(null)} />
      : !game || game.phase === 'lobby' ? <JunoLobby onRanking={() => setRankingContext(context)} />
        : game.phase === 'finished' ? <JunoResult /> : <JunoMatch key={`${context}:${game.id}`} />}
    <details className="juno-rules"><summary>{t('juno.rules')}</summary><p>{t('juno.rulesText')}</p><p>{t('juno.scoreRules')}</p></details>
  </section>;
}
