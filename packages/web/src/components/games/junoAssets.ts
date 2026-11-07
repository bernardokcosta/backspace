import type { JunoCard, JunoColor } from '@backspace/shared/src/juno';

const ROOT = '/games/juno';
export const JUNO_PALETTE: Record<JunoColor, string> = { coral: '#ff315e', amber: '#ffce29', mint: '#31e43c', sky: '#1297ff' };
export const JUNO_ASSETS = {
  background: `${ROOT}/ui/background.webp`, logo: `${ROOT}/ui/logo.svg`, orbit: `${ROOT}/ui/orbit.svg`,
  avatarFrame: `${ROOT}/ui/avatar-frame.svg`, playerPlate: `${ROOT}/ui/player-plate.svg`,
  primary: `${ROOT}/ui/button-primary.svg`, secondary: `${ROOT}/ui/button-secondary.svg`,
  crown: `${ROOT}/ui/crown.svg`, gold: `${ROOT}/ui/medal-gold.svg`, silver: `${ROOT}/ui/medal-silver.svg`,
  bronze: `${ROOT}/ui/medal-bronze.svg`, rankingRow: `${ROOT}/ui/ranking-row.svg`,
  hammer: `${ROOT}/ui/hammer.gif`, hammerStill: `${ROOT}/ui/hammer-still.webp`,
};

/** Opaque runtime ids are never artwork paths; opponents always use the same back. */
export function junoCardUrl(card?: JunoCard, back = false): string {
  if (back || !card) return `${ROOT}/cards/back.webp`;
  if (card.face === 'wild' || card.face === 'draw4' || card.face === 'memory') return `${ROOT}/cards/${card.face}.webp`;
  return `${ROOT}/cards/${card.color}-${card.face}.webp`;
}
