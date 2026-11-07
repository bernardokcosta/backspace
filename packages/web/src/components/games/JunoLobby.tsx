import { useTranslation } from 'react-i18next';
import { useJunoStore } from '../../stores/junoStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useMyRowForOrigin } from '../../stores/authStore';
import { uploadUrlOn } from '../../utils/assetUrls';
import { JunoPlayerBadge } from './JunoPlayerBadge';
import { JunoCard } from './JunoCard';
import { JUNO_ASSETS } from './junoAssets';

export function JunoLobby({ onRanking }: { onRanking: () => void }) {
  const { t } = useTranslation(['voice', 'common']);
  const { snapshot, target, connected, pending, stale, loading, command } = useJunoStore();
  const self = useMyRowForOrigin(target?.origin ?? '');
  const spaceId = useSpaceStore(s => target ? s.spaceChannelIndex.get(target.channelId)?.spaceId ?? '' : '');
  const game = snapshot?.game;
  const isPlayer = !!game?.players.some(p => p.userId === target?.selfId);
  const disabled = !connected || pending || stale || !snapshot;
  return <div className="juno-lobby">
    {!game && self && <div className="juno-lobby-identity"><JunoPlayerBadge person={{ userId: self.id, name: self.displayName ?? self.username,
      user: { ...self, avatar: uploadUrlOn(self.avatar, '') } }} origin={target?.origin ?? ''} spaceId={spaceId} self /></div>}
    <img className="juno-main-logo" src={JUNO_ASSETS.logo} alt={t('juno.name')} />
    <h2>{game ? t('juno.lobbyTitle') : t('juno.invitation')}</h2>
    <p className="sr-only">{game ? t('juno.lobbyHint') : t('juno.description')}</p>
    {game && <div className="juno-lobby-players" aria-label={t('juno.players')}>
      {game.players.map(player => <div className="juno-lobby-seat" key={player.userId}>
        <JunoPlayerBadge person={player} origin={target?.origin ?? ''} spaceId={spaceId}
          self={player.userId === target?.selfId} detail={player.userId === game.hostId ? t('juno.host') : player.computer ? undefined : t('juno.ready')} />
        {player.computer && target?.selfId === game.hostId && game.supportsBots && <button type="button" className="juno-remove-bot"
          aria-label={t('juno.removeBot', { name: t('juno.botName', { number: player.computer }) })} disabled={disabled}
          onClick={() => void command({ type: 'removeBot', botId: player.userId })}>×</button>}
      </div>)}
      {Array.from({ length: Math.max(0, 4 - game.players.length) }, (_, i) => game.supportsBots && target?.selfId === game.hostId
        ? <button type="button" className="juno-seat-empty" key={i} aria-label={t('juno.addBot')} title={t('juno.addBot')}
          disabled={disabled} onClick={() => void command({ type: 'addBot' })}><span aria-hidden="true">＋</span></button>
        : <div className="juno-seat-empty" key={i} aria-label={t('juno.emptySeat')}><span aria-hidden="true">＋</span></div>)}
    </div>}
    <div className="juno-menu-actions">
      {!game ? loading && !snapshot ? <p role="status">{t('common:states.loading')}</p>
        : <button type="button" className="juno-primary" disabled={disabled} onClick={() => void command({ type: 'create' })}>{t('juno.create')}</button>
        : target?.selfId === game.hostId ? <button type="button" className="juno-primary" disabled={disabled || game.players.length < 2} onClick={() => void command({ type: 'start' })}>{t('juno.start')}</button>
          : !isPlayer ? <button type="button" className="juno-primary" disabled={disabled || game.players.length >= 4} onClick={() => void command({ type: 'join' })}>{game.players.length >= 4 ? t('juno.full') : t('juno.join')}</button>
            : <p role="status">{t('juno.waitingHost')}</p>}
      <button type="button" className="juno-secondary" onClick={onRanking}>{t('juno.rankingTitle')}</button>
    </div>
    {game && <p className="sr-only">{t('juno.seats', { occupied: game.players.length, max: 4 })}</p>}
    <div className="juno-lobby-cards" aria-hidden="true"><JunoCard card={{ id: 'decoration', color: 'coral', face: '5' }} />
      <JunoCard card={{ id: 'decoration', color: 'mint', face: '2' }} /><JunoCard card={{ id: 'decoration', color: 'sky', face: '4' }} />
      <JunoCard card={{ id: 'decoration', color: null, face: 'draw4' }} /></div>
  </div>;
}
