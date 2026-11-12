import { JUNO_TURN_MS, type JunoView } from '@veyvox/shared/src/juno';

/** Names resolve through AudioManager's existing /sounds/${name}.ogg cache. */
export const JUNO_SOUNDS = {
  play: { sound: 'juno/carta_jogada', gain: .65, lane: 'move' },
  draw: { sound: 'juno/carta_comprada', gain: .65, lane: 'move' },
  draw2: { sound: 'juno/mais_dois', gain: .70, lane: 'move' },
  draw4: { sound: 'juno/mais_quatro', gain: .70, lane: 'move' },
  reverse: { sound: 'juno/inverter', gain: .70, lane: 'move' },
  skip: { sound: 'juno/bloquear', gain: .70, lane: 'move' },
  wild: { sound: 'juno/coringa', gain: .70, lane: 'move' },
  memory: { sound: 'juno_memory', gain: 1, lane: 'move' },
  intoxicated: { sound: 'juno_intoxicated', gain: 1, lane: 'move' },
  turn: { sound: 'juno/seu_turno', gain: .65, lane: 'turn' },
  announce: { sound: 'juno/uno', gain: .70, lane: 'announcement' },
  report: { sound: 'juno/denuncia_martelo', gain: .70, lane: 'move' },
  victory: { sound: 'juno/vitoria', gain: .70, lane: 'result' },
  defeat: { sound: 'juno/derrota', gain: .65, lane: 'result' },
  invalid: { sound: 'juno/jogada_invalida', gain: .35, lane: 'interface' },
  button: { sound: 'juno/botao', gain: .35, lane: 'interface' },
  shuffle: { sound: 'juno/embaralhar', gain: .65, lane: 'move' },
  select: { sound: 'juno/selecionar_carta', gain: .35, lane: 'interface' },
} as const;
export type JunoSoundCue = keyof typeof JUNO_SOUNDS;
export type JunoSoundLane = typeof JUNO_SOUNDS[JunoSoundCue]['lane'];

/** Only compare consecutive confirmed views in the same round, never history. */
export function junoMoveSounds(previous: JunoView, game: JunoView, selfId: string): JunoSoundCue[] {
  const move = game.lastMove;
  if (previous.id !== game.id || !move?.id || move.id === previous.lastMove?.id) return [];
  if (previous.phase === 'playing' && game.phase === 'finished') {
    return game.winnerId && game.players.some(p => p.userId === selfId)
      ? [game.winnerId === selfId ? 'victory' : 'defeat'] : [];
  }
  // Announce/report and a playable draw keep the current deadline. An unplayable
  // draw (actor is no longer current) and every memory miss advance/reset it.
  const resetsTurn = move.type === 'play' || move.type === 'start' || move.type === 'timeout' || move.type === 'pass' || move.type === 'leave'
    || move.type === 'memory_miss' || move.type === 'intoxicated_miss' || move.type === 'draw' && move.userId !== game.currentPlayerId;
  if (game.phase !== 'playing' || resetsTurn && game.remainingMs < JUNO_TURN_MS - 3_000) return [];
  const cues: JunoSoundCue[] = [];
  if (move.type === 'start') cues.push('shuffle');
  else if (move.type === 'play' && move.card) {
    const face = move.card.face;
    cues.push(face === 'draw2' || face === 'draw4' || face === 'reverse' || face === 'skip' || face === 'wild' || face === 'memory' || face === 'intoxicated' ? face : 'play');
  } else if (move.type === 'report' && (move.amount ?? 0) > 0) cues.push('report');
  else if ((move.type === 'draw' || move.type === 'timeout') && (move.amount ?? 0) > 0) cues.push('draw');
  else if (move.type === 'memory_miss' || move.type === 'intoxicated_miss') {
    if (move.userId === selfId) cues.push('invalid');
    else if ((move.amount ?? 0) > 0) cues.push('draw');
  }
  if (move.type === 'announce' || move.type === 'play' && move.announced
      && !previous.players.find(p => p.userId === move.userId)?.announced) cues.push('announce');
  if (game.currentPlayerId === selfId && game.players.some(p => p.userId === selfId)
      && (previous.phase !== 'playing' || previous.currentPlayerId !== selfId)) cues.push('turn');
  return cues;
}
