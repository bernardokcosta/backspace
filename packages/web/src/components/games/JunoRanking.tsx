import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useJunoStore } from '../../stores/junoStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useFormatters } from '../../i18n/formatters';
import { describeError } from '../../i18n/errors';
import { JunoPlayerBadge } from './JunoPlayerBadge';

export function JunoRanking({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation(['voice', 'common']); const { formatNumber } = useFormatters();
  const target = useJunoStore(s => s.target); const ranking = useJunoStore(s => s.ranking);
  const loadRanking = useJunoStore(s => s.loadRanking);
  const creditedRound = useJunoStore(s => s.snapshot?.game?.scoreboard?.status === 'credited' ? s.snapshot.game.scoreboard.roundId : null);
  const spaceId = useSpaceStore(s => target ? s.spaceChannelIndex.get(target.channelId)?.spaceId : undefined);
  const spaceName = useSpaceStore(s => s.spaces.find(sp => sp.id === spaceId)?.name);
  const scope = useMemo(() => target && spaceId ? { userId: target.userId, origin: target.origin, spaceId } : null,
    [target, spaceId]);
  const matches = !!scope && ranking.target?.userId === scope.userId && ranking.target.origin === scope.origin
    && ranking.target.spaceId === scope.spaceId;
  const page = matches ? ranking.page : null;
  const [offset, setOffset] = useState(page?.offset ?? 0);
  useEffect(() => { if (scope) void loadRanking(scope, { limit: 25, offset }); }, [scope, offset, creditedRound, loadRanking]);
  const retry = () => { if (scope) void loadRanking(scope, { limit: 25, offset }); };
  return <div className="juno-ranking">
    <div className="juno-ranking-heading"><h2>{spaceName ? t('juno.spaceRanking', { space: spaceName }) : t('juno.rankingTitle')}</h2>
      <button type="button" className="juno-text-button" onClick={onBack}>{t('juno.backToGame')}</button></div>
    <p className="juno-ranking-hint">{t('juno.scoreHint')}</p>
    {(!matches || ranking.loading) && !page && <p role="status">{t('common:states.loading')}</p>}
    {matches && ranking.unsupported && <p role="status" className="juno-notice">{t('juno.rankingUnavailable')}</p>}
    {matches && !!ranking.error && <div role="alert" className="juno-error"><span>{describeError(ranking.error, i18n)}</span>
      <button type="button" className="juno-text-button" onClick={retry}>{t('common:actions.retry')}</button></div>}
    {page && <>
      <section className="juno-your-stats" aria-label={t('juno.yourStats')}>
        <div><span>{t('juno.rank')}</span><strong>{page.me.rank === null ? t('juno.noRank') : formatNumber(page.me.rank)}</strong></div>
        <div><span>{t('juno.totalXp')}</span><strong>{formatNumber(page.me.totalXp)}</strong></div>
        <div><span>{t('juno.winsLabel')}</span><strong>{formatNumber(page.me.wins)}</strong></div>
        <div><span>{t('juno.roundsLabel')}</span><strong>{formatNumber(page.me.completedRounds)}</strong></div>
      </section>
      {page.total === 0 ? <p className="juno-ranking-empty" role="status">{t('juno.emptyRanking')}</p>
        : <ol className="juno-score-list" aria-label={t('juno.rankingTitle')}>
          {page.entries.map(row => <li key={row.user.id} className={`juno-score-row${row.rank === 1 ? ' juno-first-place' : ''}`}>
            <span className="juno-place" aria-label={t('juno.rank')}><b>{formatNumber(row.rank)}</b></span>
            <JunoPlayerBadge person={{ userId: row.user.id, name: row.nickname ?? row.user.displayName ?? row.user.username, user: row.user, nickname: row.nickname }}
              spaceId={spaceId ?? ''} self={row.user.id === target?.userId}
              detail={<>{t('juno.wins', { count: row.wins })} · {t('juno.rounds', { count: row.completedRounds })}</>} />
            <span className="juno-rank-xp"><strong>{formatNumber(row.totalXp)}</strong><small>{t('juno.totalXp')}</small></span>
          </li>)}
        </ol>}
      <div className="juno-pagination">
        <button type="button" className="juno-text-button" disabled={ranking.loading || page.offset === 0}
          onClick={() => setOffset(Math.max(0, page.offset - page.limit))}>{t('juno.previousPage')}</button>
        <span>{formatNumber(page.total ? page.offset + 1 : 0)}–{formatNumber(Math.min(page.offset + page.limit, page.total))} / {formatNumber(page.total)}</span>
        <button type="button" className="juno-text-button" disabled={ranking.loading || page.offset + page.limit >= page.total}
          onClick={() => setOffset(page.offset + page.limit)}>{t('juno.nextPage')}</button>
      </div>
    </>}
    <p className="juno-ranking-rules">{t('juno.scoreRules')}</p>
  </div>;
}
