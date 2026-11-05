/** Native Juno wire contract. Hidden hands and draw order are server-only. */
export const JUNO_COLORS = ['coral', 'amber', 'mint', 'sky'] as const;
export type JunoColor = typeof JUNO_COLORS[number];
export type JunoFace = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | 'skip' | 'reverse' | 'draw2' | 'wild' | 'draw4';
export interface JunoCard { id: string; color: JunoColor | null; face: JunoFace }
export interface JunoPerson { userId: string; name: string }
export type JunoAction = { type: 'join' | 'leave' | 'start' | 'rematch' | 'draw' | 'pass' }
  | { type: 'play'; cardId: string; color?: JunoColor; announce?: boolean };
export type JunoCommand = { type: 'create' } | (JunoAction & { gameId: string; revision: number });
export interface JunoMove {
  type: 'start' | 'play' | 'draw' | 'pass' | 'timeout' | 'leave';
  userId: string;
  card?: JunoCard;
  amount?: number;
  announced?: boolean;
}
export interface JunoView {
  id: string;
  phase: 'lobby' | 'playing' | 'finished';
  hostId: string;
  players: (JunoPerson & { cardCount: number; announced: boolean })[];
  hand: JunoCard[];
  topCard: JunoCard | null;
  color: JunoColor | null;
  direction: 1 | -1;
  currentPlayerId: string | null;
  drawnCardId: string | null;
  remainingMs: number;
  winnerId: string | null;
  result: 'emptyHand' | 'playersLeft' | 'stalemate' | 'expired' | null;
  lastMove: JunoMove | null;
}
export interface JunoSnapshot { revision: number; game: JunoView | null }
export const JUNO_TURN_MS = 45_000;

/** Presentation may highlight legal cards; the server rechecks every play. */
export function canPlayJuno(card: JunoCard, hand: readonly JunoCard[], top: JunoCard, color: JunoColor): boolean {
  if (card.face === 'draw4') return !hand.some(other => other.color === color);
  return card.face === 'wild' || card.color === color || card.face === top.face;
}
