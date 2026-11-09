import type { JunoCard, JunoColor } from '@veyvox/shared/src/juno';

const ROOT = '/games/juno';
export const JUNO_MUSIC_URL = `${ROOT}/music/charting-the-dark.mp3`;
/** Only editions with real, supplied media are selectable. UI language is separate. */
export const JUNO_DUBBINGS = { 'pt-BR': { languageCode: 'pt', memoryCard: `${ROOT}/cards/memory.webp`, memorySound: 'juno_memory' } } as const;
export type JunoDubbingLanguage = keyof typeof JUNO_DUBBINGS;
/** Match the game's UI language if a real edition exists; otherwise use supplied pt-BR. */
export function resolveJunoDubbing(selection: 'auto' | JunoDubbingLanguage, language: string): JunoDubbingLanguage {
  if (selection !== 'auto') return selection;
  const base = language.toLowerCase().split('-')[0];
  return (Object.keys(JUNO_DUBBINGS) as JunoDubbingLanguage[]).find(edition => edition.toLowerCase().split('-')[0] === base) ?? 'pt-BR';
}
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
export function junoCardUrl(card?: JunoCard, back = false, dubbing: JunoDubbingLanguage = 'pt-BR'): string {
  if (back || !card) return `${ROOT}/cards/back.webp`;
  if (card.face === 'memory') return JUNO_DUBBINGS[dubbing].memoryCard;
  if (card.face === 'wild' || card.face === 'draw4') return `${ROOT}/cards/${card.face}.webp`;
  return `${ROOT}/cards/${card.color}-${card.face}.webp`;
}
