import { useTranslation } from 'react-i18next';
import { useJunoStore } from '../../stores/junoStore';
import { JunoCard } from './JunoCard';
import { JUNO_ASSETS } from './junoAssets';
import './juno.css';

export function JunoTile({ onOpen }: { onOpen?: () => void }) {
  const { t } = useTranslation('voice');
  const game = useJunoStore(s => s.snapshot?.game);
  return <button type="button" className="juno-tile" onClick={onOpen ?? (() => useJunoStore.getState().setOpen(true))} aria-label={t('juno.open')}>
    <div className="juno-tile-cards"><JunoCard back /><JunoCard card={{ id: 'preview', face: '7', color: 'coral' }} /><JunoCard card={{ id: 'preview2', face: 'reverse', color: 'mint' }} /></div>
    <div><img className="juno-tile-logo" src={JUNO_ASSETS.logo} alt={t('juno.name')} /><span>{game?.phase === 'playing' ? t('juno.inProgress') : t('juno.seats', { occupied: game?.players.length ?? 0, max: 4 })}</span></div>
    <span className="juno-tile-open">{t('juno.open')}</span>
  </button>;
}
