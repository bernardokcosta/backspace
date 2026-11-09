import { describe, expect, it, vi } from 'vitest';
import { canPlayJuno, type JunoCard } from '@veyvox/shared/src/juno.js';
import { actInRound, createJunoDeck, JunoRooms, startRound, type JunoRound } from './juno.js';
import { chooseJunoBlindCard } from './junoBot.js';

const card = (id: string, face: JunoCard['face'] = '3', color: JunoCard['color'] = 'mint'): JunoCard => ({ id, face, color });
function round(): JunoRound {
  return { players: [
    { userId: 'a', name: 'A', hand: [card('memory', 'memory', null), card('a-other', '5', 'amber')], announced: false },
    { userId: 'b', name: 'B', hand: [card('good'), card('bad', '3', 'sky'), card('wild', 'wild', null), card('plus4', 'draw4', null)], announced: false },
    { userId: 'c', name: 'C', hand: [card('c-other', '8', 'coral')], announced: false },
  ], drawPile: Array.from({ length: 20 }, (_, i) => card(`draw-${i}`, '9', 'amber')),
  discard: [card('top', '3')], color: 'mint', direction: 1, turn: 0, drawnCardId: null,
  deadline: 45_000, winnerId: null, result: null, lastMove: null, blockedTurns: 0, reportWindows: [], memoryEnabled: true };
}
function curse(state = round()): JunoRound {
  actInRound(state, 'a', { type: 'play', cardId: 'memory', color: 'coral' }, 1); return state;
}
const total = (state: JunoRound) => state.drawPile.length + state.discard.length + state.players.reduce((n, p) => n + p.hand.length, 0);
function room(capable = true) {
  let now = 0;
  const rooms = new JunoRooms({ now: () => now, present: () => true, changed: vi.fn() });
  let view = rooms.command('voice', { userId: 'a', name: 'A' }, { type: 'create' }, true);
  for (const userId of ['b', 'c']) view = rooms.command('voice', { userId, name: userId }, { type: 'join', gameId: view.game!.id, revision: view.revision }, capable);
  view = rooms.command('voice', { userId: 'a', name: 'A' }, { type: 'start', gameId: view.game!.id, revision: view.revision }, true);
  const table = (rooms as unknown as { tables: Map<string, { round: JunoRound }> }).tables.get('voice')!;
  return { rooms, table, view, setNow: (value: number) => { now = value; } };
}

describe('Juno memory curse', () => {
  it.each([2, 3, 4])('completes deterministic enhanced %i-player rounds conserving all 109 ids', count => {
    for (let sample = 1; sample <= 12; sample++) {
      let seed = sample;
      const random = (size: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % size; };
      const deck = createJunoDeck(true);
      for (let i = deck.length - 1; i > 0; i--) { const j = random(i + 1); [deck[i], deck[j]] = [deck[j]!, deck[i]!]; }
      const state = round(); state.players = Array.from({ length: count }, (_, i) => ({ userId: String(i), name: String(i), hand: deck.splice(0, 7), announced: false }));
      state.discard = deck.splice(deck.findIndex(c => /^\d$/.test(c.face)), 1); state.color = state.discard[0]!.color!; state.drawPile = deck;
      const original = new Set([...deck, ...state.discard, ...state.players.flatMap(p => p.hand)].map(c => c.id));
      let moves = 0;
      while (!state.result && moves++ < 5000) {
        const player = state.players[state.turn]!;
        const selected = state.memoryCurse ? player.hand[random(player.hand.length)] : player.hand.find(c => (!state.drawnCardId || c.id === state.drawnCardId) && canPlayJuno(c, player.hand, state.discard.at(-1)!, state.color));
        actInRound(state, player.userId, selected ? { type: 'play', cardId: selected.id, color: 'mint', announce: true } : { type: state.drawnCardId ? 'pass' : 'draw' }, moves);
        const cards = [...state.drawPile, ...state.discard, ...state.players.flatMap(p => p.hand)];
        expect(cards).toHaveLength(109); expect(new Set(cards.map(c => c.id))).toEqual(original);
      }
      expect(state.result).toBeTruthy(); expect(state.memoryCurse).toBeUndefined();
    }
  });
  it.each(['good', 'bad'] as const)('returns the turn to the author after a two-player blind %s attempt', id => {
    const state = round(); state.players.pop(); curse(state); actInRound(state, 'b', { type: 'play', cardId: id }, 2);
    expect(state.turn).toBe(0); expect(state.memoryCurse).toBeUndefined(); expect(state.players[1]!.hand).toHaveLength(id === 'good' ? 3 : 6);
  });
  it('refreshes lobby support but freezes the deck until rematch', () => {
    const rooms = new JunoRooms({ now: () => 0, present: () => true, changed: vi.fn() });
    let view = rooms.command('v', { userId: 'a', name: 'A' }, { type: 'create' }, true);
    const send = (userId: string, type: 'join' | 'start' | 'rematch', support: boolean) => {
      view = rooms.command('v', { userId, name: userId }, { type, gameId: view.game!.id, revision: view.revision }, support);
    };
    send('b', 'join', false); rooms.read('v', 'b', true); send('a', 'start', true);
    expect(view.game?.memoryEnabled).toBe(true);
    expect(() => rooms.read('v', 'b', false)).toThrow('juno_update_required');
    const table = (rooms as unknown as { tables: Map<string, { round: JunoRound }> }).tables.get('v')!;
    table.round.result = 'expired'; send('a', 'rematch', true); send('b', 'join', true);
    rooms.read('v', 'b', false); send('a', 'start', true); expect(view.game?.memoryEnabled).toBe(false);
    rooms.read('v', 'b', true); expect(rooms.read('v', 'a', true).game?.memoryEnabled).toBe(false);
  });
  it('clears the curse on absolute expiry and when departure ends the round', () => {
    const { rooms, table, setNow } = room(); table.round = curse(); setNow(2 * 60 * 60_000); rooms.tick();
    expect(table.round.result).toBe('expired'); expect(table.round.memoryCurse).toBeUndefined();
    const next = room(); next.table.round = curse(); next.table.round.players.pop();
    const view = next.rooms.read('voice', 'b', true);
    next.rooms.command('voice', { userId: 'b', name: 'B' }, { type: 'leave', gameId: view.game!.id, revision: view.revision }, true);
    expect(next.table.round.memoryCurse).toBeUndefined(); expect(next.table.round.result).toBe('playersLeft');
  });
  it('adds exactly one rare card only in an enabled deck and never starts on it', () => {
    expect(createJunoDeck()).toHaveLength(108);
    const deck = createJunoDeck(true);
    expect(deck).toHaveLength(109); expect(new Set(deck.map(c => c.id)).size).toBe(109);
    expect(deck.filter(c => c.face === 'memory')).toHaveLength(1);
    const state = startRound([{ userId: 'a', name: 'A' }, { userId: 'b', name: 'B' }], 0, true);
    expect(total(state)).toBe(109); expect(state.discard[0]!.face).toMatch(/^\d$/);
  });
  it.each([1, -1] as const)('keeps the color and targets the next player in direction %i', direction => {
    const state = round(); state.direction = direction; const count = total(state); curse(state);
    expect(state.color).toBe('mint'); expect(state.turn).toBe(direction === 1 ? 1 : 2);
    expect(state.memoryCurse?.targetUserId).toBe(direction === 1 ? 'b' : 'c');
    expect(state.memoryCurse?.id).toBe(state.lastMove?.id); expect(total(state)).toBe(count);
  });
  it('accepts a matching blind play, removes the curse and applies its normal special effect', () => {
    const state = round(); state.players[1]!.hand[0] = card('good', 'reverse'); curse(state);
    actInRound(state, 'b', { type: 'play', cardId: 'good' }, 2);
    expect(state.memoryCurse).toBeUndefined(); expect(state.direction).toBe(-1); expect(state.turn).toBe(0);
    expect(state.discard.at(-1)?.id).toBe('good');
  });
  it('keeps a wrong-color card private, draws two, cures and passes exactly once', () => {
    const state = curse(); const count = total(state);
    actInRound(state, 'b', { type: 'play', cardId: 'bad' }, 2);
    expect(state.players[1]!.hand).toHaveLength(6); expect(state.players[1]!.hand.some(c => c.id === 'bad')).toBe(true);
    expect(state.memoryCurse).toBeUndefined(); expect(state.turn).toBe(2); expect(state.color).toBe('mint');
    expect(state.discard.at(-1)?.id).toBe('memory'); expect(total(state)).toBe(count);
    expect(state.lastMove).toMatchObject({ type: 'memory_miss', userId: 'b', amount: 2 });
    expect(state.lastMove?.card).toBeUndefined();
    const saved = JSON.stringify(state);
    expect(() => actInRound(state, 'b', { type: 'play', cardId: 'bad' }, 3)).toThrow('juno_not_your_turn');
    expect(JSON.stringify(state)).toBe(saved);
  });
  it('does not turn malformed, unowned or out-of-turn attempts into penalties', () => {
    const state = curse(); const before = JSON.stringify(state);
    expect(() => actInRound(state, 'b', { type: 'play', cardId: 'not-owned' }, 2)).toThrow('juno_invalid_move');
    expect(() => actInRound(state, 'c', { type: 'play', cardId: 'c-other' }, 2)).toThrow('juno_not_your_turn');
    expect(JSON.stringify(state)).toBe(before);
  });
  it.each(['draw', 'pass'] as const)('cannot bypass the blind attempt with %s', type => {
    const state = curse(); const before = JSON.stringify(state);
    expect(() => actInRound(state, 'b', { type }, 2)).toThrow('juno_invalid_move');
    expect(JSON.stringify(state)).toBe(before);
  });
  it('plays a blind wild without a color picker and preserves the inherited color', () => {
    const state = curse(); actInRound(state, 'b', { type: 'play', cardId: 'wild', color: 'sky' }, 2);
    expect(state.memoryCurse).toBeUndefined(); expect(state.color).toBe('mint'); expect(state.turn).toBe(2);
  });
  it('keeps the existing +4 restriction during the curse', () => {
    const state = curse(); actInRound(state, 'b', { type: 'play', cardId: 'plus4' }, 2);
    expect(state.lastMove?.type).toBe('memory_miss'); expect(state.players[1]!.hand).toHaveLength(6);
    const allowed = round(); allowed.players[1]!.hand = [card('plus4', 'draw4', null), card('bad', '2', 'sky')]; curse(allowed);
    actInRound(allowed, 'b', { type: 'play', cardId: 'plus4' }, 2);
    expect(allowed.color).toBe('mint'); expect(allowed.players[2]!.hand).toHaveLength(5); expect(allowed.turn).toBe(0);
  });
  it('handles deck scarcity and recycling without losing the attempted card', () => {
    const state = curse(); state.drawPile = []; const count = total(state);
    actInRound(state, 'b', { type: 'play', cardId: 'bad' }, 2);
    expect(state.lastMove?.amount).toBe(1); expect(state.discard.at(-1)?.face).toBe('memory'); expect(total(state)).toBe(count);
  });
  it('does not retain a curse after a last-card victory', () => {
    const state = round(); state.players[0]!.hand.splice(1); curse(state);
    expect(state.winnerId).toBe('a'); expect(state.result).toBe('emptyHand'); expect(state.memoryCurse).toBeUndefined();
    expect(state.lastMove?.card?.face).toBe('memory');
  });
  it('keeps the curse through an independent report and allows a two-card JUNO call', () => {
    const state = round(); state.players[1]!.hand = [card('good')];
    state.reportWindows = [{ id: 'miss', targetUserId: 'b', deadline: 10_000 }]; curse(state);
    actInRound(state, 'c', { type: 'report', targetUserId: 'b', opportunityId: 'miss' }, 2);
    expect(state.players[1]!.hand).toHaveLength(3); expect(state.memoryCurse?.targetUserId).toBe('b');
    state.players[1]!.hand.pop(); actInRound(state, 'b', { type: 'announce' }, 3);
    expect(state.players[1]!.announced).toBe(true); expect(state.memoryCurse?.targetUserId).toBe('b');
  });
  it('freezes a classic deck for mixed clients and an enhanced deck for capable clients', () => {
    expect(room(false).view.game?.memoryEnabled).toBe(false);
    expect(room(true).view.game?.memoryEnabled).toBe(true);
  });
  it('redacts only the victim and cannot downgrade the private view by omitting support', () => {
    const { rooms, table } = room(); table.round = curse();
    const victim = rooms.read('voice', 'b', true);
    expect(victim.supportsMemory).toBe(true); expect(victim.game?.hand).toEqual([]);
    expect(victim.game?.maskedHand).toEqual(['good', 'bad', 'wild', 'plus4'].map(id => ({ id })));
    expect(victim.game?.color).toBeNull(); expect(victim.game?.topCard).toBeNull(); expect(victim.game?.drawnCardId).toBeNull();
    expect(rooms.read('voice', 'a', true).game?.hand).toHaveLength(1);
    expect(rooms.read('voice', 'a', true).game?.color).toBe('mint');
    expect(rooms.read('voice', 'watcher', true).game?.hand).toEqual([]);
    expect(() => rooms.read('voice', 'b')).toThrow('juno_update_required');
    const saved = JSON.stringify(table.round);
    expect(() => rooms.command('voice', { userId: 'b', name: 'B' }, { type: 'play', cardId: 'bad', gameId: victim.game!.id, revision: victim.revision })).toThrow('juno_update_required');
    expect(JSON.stringify(table.round)).toBe(saved);
  });
  it('applies the same timeout penalty once and clears a departing victim without transferring it', () => {
    const { rooms, table, setNow } = room(); table.round = curse();
    setNow(45_001); rooms.tick(); rooms.tick();
    expect(table.round.players[1]!.hand).toHaveLength(6); expect(table.round.turn).toBe(2); expect(table.round.memoryCurse).toBeUndefined();
    table.round = curse(); setNow(2);
    const view = rooms.read('voice', 'b', true);
    const left = rooms.command('voice', { userId: 'b', name: 'B' }, { type: 'leave', gameId: view.game!.id, revision: view.revision });
    expect(left.game).toBeNull(); expect(table.round.memoryCurse).toBeUndefined(); expect(table.round.players).toHaveLength(2);
  });
  it('selects a computer blind slot using only opaque ids', () => {
    expect(chooseJunoBlindCard(['only'])).toBe('only');
    const ids = Object.freeze(['opaque-a', 'opaque-b', 'opaque-c']);
    for (let i = 0; i < 20; i++) expect(ids).toContain(chooseJunoBlindCard(ids));
  });
});
