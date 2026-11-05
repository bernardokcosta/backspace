import type { JunoCard as Card } from '@backspace/shared/src/juno';
import { junoCardUrl } from './junoAssets';
export { JUNO_PALETTE } from './junoAssets';

/** The enclosing localized control owns the accessible card name. */
export function JunoCard({ card, back = false }: { card?: Card; back?: boolean }) {
  return <img className="juno-card-art" src={junoCardUrl(card, back)} alt="" aria-hidden="true"
    width="720" height="1056" draggable={false} decoding="async" />;
}
