import { useTranslation } from 'react-i18next';
import { useJunoStore } from '../../stores/junoStore';
import { JunoCard } from './JunoCard';
import './juno.css';

export function JunoTile() {
  const { t } = useTranslation('voice');
  const game = useJunoStore(s => s.snapshot?.game);
  return <button type="button" className="juno-tile" onClick={() => useJunoStore.getState().setOpen(true)} aria-label={t('juno.open')}>
    <div className="juno-tile-cards"><JunoCard back /><JunoCard card={{ id: 'preview', face: '7', color: 'coral' }} /><JunoCard card={{ id: 'preview2', face: 'reverse', color: 'mint' }} /></div>
    <div><strong>{t('juno.name')}</strong><span>{game?.phase === 'playing' ? t('juno.inProgress') : t('juno.seats', { occupied: game?.players.length ?? 0, max: 4 })}</span></div>
    <span className="juno-tile-open">{t('juno.open')}</span>
  </button>;
}
