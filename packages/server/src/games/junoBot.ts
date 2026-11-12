import { randomInt } from 'node:crypto';
import { JUNO_COLORS, canPlayJuno, type JunoAction, type JunoCard, type JunoColor } from '@veyvox/shared/src/juno.js';

/** Deliberately cannot receive a round, another hand, or the draw pile. */
export function chooseJunoBotAction(hand: readonly JunoCard[], top: JunoCard, color: JunoColor, drawnCardId: string | null): JunoAction {
  const legal = hand.filter(card => (!drawnCardId || card.id === drawnCardId) && canPlayJuno(card, hand, top, color));
  const card = legal.find(card => card.color !== null) ?? legal[0];
  if (!card) return { type: drawnCardId ? 'pass' : 'draw' };
  const colors = JUNO_COLORS.map(color => ({ color, count: hand.filter(other => other.id !== card.id && other.color === color).length }));
  colors.sort((a, b) => b.count - a.count);
  return { type: 'play', cardId: card.id, announce: true, ...(card.color === null && card.face !== 'memory' && card.face !== 'intoxicated' ? { color: colors[0]!.color } : {}) };
}

/** No faces, active color or round are available to a cursed computer. */
export function chooseJunoBlindCard(cardIds: readonly string[]): string {
  if (!cardIds.length) throw new RangeError('A blind Juno turn requires an owned card');
  return cardIds[randomInt(cardIds.length)]!;
}
