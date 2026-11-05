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
  const { snapshot, target, connected, pending, loading, command } = useJunoStore();
  const self = useMyRowForOrigin(target?.origin ?? '');
  const spaceId = useSpaceStore(s => target ? s.spaceChannelIndex.get(target.channelId)?.spaceId ?? '' : '');
  const game = snapshot?.game;
  const isPlayer = !!game?.players.some(p => p.userId === target?.selfId);
  const disabled = !connected || pending || !snapshot;
  return <div className="juno-lobby">
    {!game && self && <div className="juno-lobby-identity"><JunoPlayerBadge person={{ userId: self.id, name: self.displayName ?? self.username,
      user: { ...self, avatar: uploadUrlOn(self.avatar, '') } }} origin={target?.origin ?? ''} spaceId={spaceId} self /></div>}
    <img className="juno-main-logo" src={JUNO_ASSETS.logo} alt={t('juno.name')} />
    <h2>{game ? t('juno.lobbyTitle') : t('juno.invitation')}</h2>
    <p>{game ? t('juno.lobbyHint') : t('juno.description')}</p>
    {game && <div className="juno-lobby-players" aria-label={t('juno.players')}>
      {game.players.map(player => <JunoPlayerBadge key={player.userId} person={player} origin={target?.origin ?? ''} spaceId={spaceId}
        self={player.userId === target?.selfId} detail={player.userId === game.hostId ? t('juno.host') : t('juno.ready')} />)}
      {Array.from({ length: Math.max(0, 4 - game.players.length) }, (_, i) => <div className="juno-seat-empty" key={i}>
        <span aria-hidden="true">+</span>{t('juno.emptySeat')}</div>)}
    </div>}
    <div className="juno-menu-actions">
      {!game ? loading && !snapshot ? <p role="status">{t('common:states.loading')}</p>
        : <button type="button" className="juno-primary" disabled={disabled} onClick={() => void command({ type: 'create' })}>{t('juno.create')}</button>
        : target?.selfId === game.hostId ? <button type="button" className="juno-primary" disabled={disabled || game.players.length < 2} onClick={() => void command({ type: 'start' })}>{t('juno.start')}</button>
          : !isPlayer ? <button type="button" className="juno-primary" disabled={disabled || game.players.length >= 4} onClick={() => void command({ type: 'join' })}>{game.players.length >= 4 ? t('juno.full') : t('juno.join')}</button>
            : <p role="status">{t('juno.waitingHost')}</p>}
      <button type="button" className="juno-secondary" onClick={onRanking}>{t('juno.rankingTitle')}</button>
    </div>
    {game && <p className="juno-seat-count">{t('juno.seats', { occupied: game.players.length, max: 4 })}</p>}
    <div className="juno-lobby-cards" aria-hidden="true"><JunoCard card={{ id: 'decoration', color: 'coral', face: '5' }} />
      <JunoCard card={{ id: 'decoration', color: 'mint', face: '2' }} /><JunoCard card={{ id: 'decoration', color: 'sky', face: '4' }} />
      <JunoCard card={{ id: 'decoration', color: null, face: 'draw4' }} /></div>
  </div>;
}
