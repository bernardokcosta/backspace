import type { JunoCard as Card } from '@veyvox/shared/src/juno';
import { junoCardUrl, resolveJunoDubbing } from './junoAssets';
import { useJunoPreferences } from '../../stores/junoPreferences';
import { useTranslation } from 'react-i18next';
export { JUNO_PALETTE } from './junoAssets';

/** The enclosing localized control owns the accessible card name. */
export function JunoCard({ card, back = false }: { card?: Card; back?: boolean }) {
  const dubbing = useJunoPreferences(s => s.dubbingLanguage);
  const { i18n } = useTranslation('voice');
  return <img className="juno-card-art" src={junoCardUrl(card, back, resolveJunoDubbing(dubbing, i18n.resolvedLanguage ?? i18n.language))} alt="" aria-hidden="true"
    width="720" height="1056" draggable={false} decoding="async" />;
}
