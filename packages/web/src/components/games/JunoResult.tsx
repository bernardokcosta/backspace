import { useTranslation } from 'react-i18next';
import { useJunoStore } from '../../stores/junoStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useFormatters } from '../../i18n/formatters';
import { JunoPlayerBadge } from './JunoPlayerBadge';
import { JUNO_ASSETS } from './junoAssets';

const RESULT_KEYS = { emptyHand: 'juno.finished', playersLeft: 'juno.results.playersLeft', stalemate: 'juno.results.stalemate', expired: 'juno.results.expired' } as const;
export function JunoResult() {
  const { t } = useTranslation(['voice', 'common']);
  const { formatNumber } = useFormatters();
  const { snapshot, target, pending, connected, command } = useJunoStore();
  const spaceId = useSpaceStore(s => target ? s.spaceChannelIndex.get(target.channelId)?.spaceId ?? '' : '');
  const game = snapshot?.game;
  if (!game || game.phase !== 'finished') return null;
  const board = game.scoreboard; const saving = board?.status === 'pending';
  const winner = [...game.players, ...(board?.standings ?? [])].find(p => p.userId === game.winnerId);
  const won = !!game.winnerId && game.winnerId === target?.selfId;
  return <div className="juno-result">
    {game.winnerId && <img className="juno-crown" src={JUNO_ASSETS.crown} alt="" aria-hidden="true" />}
    <h2>{won ? t('juno.victory') : t('juno.roundResults')}{saving && <span className="juno-saving" title={t('juno.creditPending')} aria-hidden="true">◌</span>}</h2>
    <p role="status">{winner ? t('juno.winner', { name: winner.computer ? t('juno.botName', { number: winner.computer }) : winner.name }) : t('juno.finished')}</p>
    {game.result && !winner && <p>{t(RESULT_KEYS[game.result])}</p>}
    {saving && <p className="sr-only" role="status">{t('juno.creditPending')}</p>}
    {board && <ol className="juno-score-list" aria-label={t('juno.roundResults')}>
      {board.standings.map(row => <li key={row.userId} className={`juno-score-row${row.place === 1 ? ' juno-first-place' : ''}`}>
        <span className="juno-place" aria-label={t('juno.rank')}>
          {row.place && row.place <= 3 && <img src={row.place === 1 ? JUNO_ASSETS.gold : row.place === 2 ? JUNO_ASSETS.silver : JUNO_ASSETS.bronze} alt="" aria-hidden="true" />}
          <b>{row.place ? formatNumber(row.place) : '—'}</b>
        </span>
        <JunoPlayerBadge person={row} origin={target?.origin ?? ''} spaceId={spaceId} self={row.userId === target?.selfId}
          detail={row.outcome === 'abandoned' ? t('juno.abandoned') : row.cardCount !== null ? t('juno.cardCount', { count: row.cardCount }) : undefined} />
        <span className="juno-earned">{game.practice ? t('juno.practice') : saving ? t('common:states.loading') : board.status === 'credited' && row.outcome === 'completed'
          ? t('juno.xpEarned', { xp: formatNumber(row.xp) }) : t('juno.unranked')}</span>
      </li>)}
    </ol>}
    <div className="juno-result-actions">
      {target?.selfId === game.hostId ? <button type="button" className="juno-primary" disabled={!connected || pending || saving}
        onClick={() => void command({ type: 'rematch' })}>{t('juno.rematch')}</button>
        : <p role="status">{t('juno.waitingHost')}</p>}
      <button type="button" className="juno-secondary" onClick={() => useJunoStore.getState().setOpen(false)}>{t('juno.mosaic')}</button>
    </div>
  </div>;
}
