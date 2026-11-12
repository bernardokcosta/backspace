import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomInt } from 'node:crypto';
import { canPlayJuno, JUNO_COLORS, type JunoCard } from '@veyvox/shared/src/juno.js';
import { actInRound, createJunoDeck, JunoRooms, startRound, type JunoRound } from './juno.js';
import { chooseJunoBlindCard, chooseJunoBotAction } from './junoBot.js';

vi.mock('node:crypto', async original => ({ ...await original<typeof import('node:crypto')>(), randomInt: vi.fn(() => 0) }));
const random = vi.mocked(randomInt as (max: number) => number);
beforeEach(() => { random.mockReset().mockReturnValue(0); });
type State = JunoRound;
const card = (id: string, face: JunoCard['face'] = '3', color: JunoCard['color'] = 'mint'): JunoCard => ({ id, face, color });
function round(): State {
  return { players: [
    { userId: 'a', name: 'A', hand: [card('intoxicated', 'intoxicated', null), card('a-other', '5', 'amber')], announced: false },
    { userId: 'b', name: 'B', hand: [card('good'), card('b-other', '2', 'sky'), card('wild', 'wild', null), card('plus4', 'draw4', null)], announced: false },
    { userId: 'c', name: 'C', hand: [card('c-other', '8', 'coral')], announced: false },
  ], drawPile: Array.from({ length: 20 }, (_, i) => card(`draw-${i}`, '9', 'amber')),
  discard: [card('top', '3')], color: 'mint', direction: 1, turn: 0, drawnCardId: null,
  deadline: 45_000, winnerId: null, result: null, lastMove: null, blockedTurns: 0, reportWindows: [], memoryEnabled: true, intoxicatedEnabled: true };
}
function intoxicate(state = round()): State { actInRound(state, 'a', { type: 'play', cardId: 'intoxicated' }, 1); return state; }
const total = (state: State) => state.drawPile.length + state.discard.length + state.players.reduce((n, p) => n + p.hand.length, 0);
function room(capable = true) {
  let now = 0;
  const rooms = new JunoRooms({ now: () => now, present: () => true, changed: vi.fn() });
  let view = rooms.command('voice', { userId: 'a', name: 'A' }, { type: 'create' }, true, true);
  for (const userId of ['b', 'c']) view = rooms.command('voice', { userId, name: userId }, { type: 'join', gameId: view.game!.id, revision: view.revision }, true, capable);
  view = rooms.command('voice', { userId: 'a', name: 'A' }, { type: 'start', gameId: view.game!.id, revision: view.revision }, true, true);
  const table = (rooms as unknown as { tables: Map<string, { round: State }> }).tables.get('voice')!;
  return { rooms, table, view, setNow: (value: number) => { now = value; } };
}

describe('single-turn Entorpecido', () => {
  it.each([2, 3, 4])('completes seeded %i-player enhanced rounds with every one of the 110 cards conserved', count => {
    for (let sample = 1; sample <= 6; sample++) {
      let seed = sample;
      const roll = (max: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % max; };
      random.mockImplementation(roll);
      const state = startRound(Array.from({ length: count }, (_, i) => ({ userId: String(i), name: String(i) })), 0, true, true);
      const original = new Set([...state.drawPile, ...state.discard, ...state.players.flatMap(p => p.hand)].map(c => c.id));
      let moves = 0;
      while (!state.result && moves++ < 5000) {
        const player = state.players[state.turn]!;
        const action = state.memoryCurse ? { type: 'play' as const, cardId: chooseJunoBlindCard(player.hand.map(c => c.id)), announce: true }
          : chooseJunoBotAction(player.hand, state.discard.at(-1)!, state.color, state.drawnCardId);
        actInRound(state, player.userId, action, moves);
        const cards = [...state.drawPile, ...state.discard, ...state.players.flatMap(p => p.hand)];
        expect(cards).toHaveLength(110); expect(new Set(cards.map(c => c.id))).toEqual(original);
      }
      expect(state.result).toBeTruthy(); expect(state.intoxication).toBeUndefined(); expect(state.memoryCurse).toBeUndefined();
    }
  });
  it('adds exactly one distinct card and never uses it as the starting discard', () => {
    expect(createJunoDeck()).toHaveLength(108);
    expect(createJunoDeck(true)).toHaveLength(109);
    const cards = createJunoDeck(true, true);
    expect(cards).toHaveLength(110); expect(new Set(cards.map(c => c.id)).size).toBe(110);
    expect(cards.filter(c => c.face === 'intoxicated')).toHaveLength(1);
    const state = startRound([{ userId: 'a', name: 'A' }, { userId: 'b', name: 'B' }], 0, true, true);
    expect(total(state)).toBe(110); expect(state.discard[0]!.face).toMatch(/^\d$/);
  });
  it.each([1, -1] as const)('plays on any face/color, keeps color and targets direction %i', direction => {
    const state = round(); state.direction = direction;
    expect(canPlayJuno(state.players[0]!.hand[0]!, state.players[0]!.hand, state.discard[0]!, state.color)).toBe(true);
    intoxicate(state);
    expect(state.color).toBe('mint'); expect(state.intoxication?.targetUserId).toBe(direction === 1 ? 'b' : 'c');
    expect(state.intoxication?.id).toBe(state.lastMove?.id);
  });
  it('a failed ordinary play keeps both cards, draws two and passes once without applying effects', () => {
    const state = intoxicate(); const count = total(state);
    state.players[1]!.hand[0] = card('good', 'reverse');
    actInRound(state, 'b', { type: 'play', cardId: 'good' }, 2);
    expect(random).toHaveBeenCalledWith(2);
    expect(state.direction).toBe(1); expect(state.turn).toBe(2); expect(state.intoxication).toBeUndefined();
    expect(state.players[1]!.hand.map(c => c.id)).toEqual(expect.arrayContaining(['good', 'b-other']));
    expect(state.players[1]!.hand).toHaveLength(6); expect(state.discard.at(-1)?.id).toBe('intoxicated');
    expect(state.lastMove).toMatchObject({ type: 'intoxicated_miss', userId: 'b', amount: 2, misplayedCard: { id: 'b-other' } });
    expect(state.lastMove?.card).toBeUndefined(); expect(total(state)).toBe(count);
  });
  it('the other 50% plays normally, including reverse, and cures immediately', () => {
    const state = intoxicate(); state.players[1]!.hand[0] = card('good', 'reverse');
    random.mockReturnValueOnce(1);
    actInRound(state, 'b', { type: 'play', cardId: 'good' }, 2);
    expect(state.direction).toBe(-1); expect(state.turn).toBe(0); expect(state.players[1]!.hand).toHaveLength(3);
    expect(state.lastMove).toMatchObject({ type: 'play', card: { id: 'good' } }); expect(state.intoxication).toBeUndefined();
  });
  it.each(JUNO_COLORS)('a wild choosing %s can choose only one of the other three colors without an extra draw', chosen => {
    for (let alternative = 0; alternative < 3; alternative++) {
      const state = intoxicate(); const count = state.players[1]!.hand.length;
      random.mockReset().mockReturnValueOnce(0).mockReturnValueOnce(alternative);
      actInRound(state, 'b', { type: 'play', cardId: 'wild', color: chosen }, 2);
      expect(state.color).toBe(JUNO_COLORS.filter(c => c !== chosen)[alternative]);
      expect(state.players[1]!.hand).toHaveLength(count - 1); expect(state.intoxication).toBeUndefined();
      expect(state.lastMove).toMatchObject({ type: 'play', card: { id: 'wild' }, intoxicatedColor: true });
    }
  });
  it('a successful wild preserves the requested color and the existing +4 penalty is not replaced', () => {
    const state = intoxicate(); random.mockReturnValueOnce(1);
    actInRound(state, 'b', { type: 'play', cardId: 'wild', color: 'sky' }, 2); expect(state.color).toBe('sky');
    const plus = intoxicate(); plus.players[1]!.hand = [card('plus4', 'draw4', null), card('other', '2', 'sky')];
    actInRound(plus, 'b', { type: 'play', cardId: 'plus4', color: 'amber' }, 2);
    expect(plus.players[2]!.hand).toHaveLength(5); expect(plus.players[1]!.hand).toHaveLength(1);
    expect(plus.turn).toBe(0); expect(plus.intoxication).toBeUndefined();
  });
  it('rejects illegal, unowned, out-of-turn and missing-color attempts before rolling or consuming the effect', () => {
    const state = intoxicate(); const before = JSON.stringify(state); random.mockClear();
    for (const [userId, action] of [
      ['b', { type: 'play', cardId: 'b-other' }], ['b', { type: 'play', cardId: 'not-owned' }],
      ['c', { type: 'play', cardId: 'c-other' }], ['b', { type: 'play', cardId: 'plus4', color: 'sky' }],
      ['b', { type: 'play', cardId: 'wild' }],
    ] as const) expect(() => actInRound(state, userId, action, 2)).toThrow();
    expect(JSON.stringify(state)).toBe(before); expect(randomInt).not.toHaveBeenCalled();
  });
  it('a last-card ordinary miss cannot win or invent an alternative; successful last-card plays still win', () => {
    const state = intoxicate(); state.players[1]!.hand = [card('good')];
    actInRound(state, 'b', { type: 'play', cardId: 'good' }, 2);
    expect(state.result).toBeNull(); expect(state.players[1]!.hand).toHaveLength(3); expect(state.lastMove?.misplayedCard).toBeUndefined();
    const success = intoxicate(); success.players[1]!.hand = [card('good')]; random.mockReturnValueOnce(1);
    actInRound(success, 'b', { type: 'play', cardId: 'good' }, 2); expect(success.winnerId).toBe('b'); expect(success.intoxication).toBeUndefined();
    const source = round(); source.players[0]!.hand.splice(1); intoxicate(source);
    expect(source.winnerId).toBe('a'); expect(source.intoxication).toBeUndefined();
  });
  it('preserves status during announce/playable draw, and clears it on pass or turn-ending draw', () => {
    const state = intoxicate(); state.players[1]!.hand.splice(2);
    actInRound(state, 'b', { type: 'announce' }, 2); expect(state.intoxication?.targetUserId).toBe('b');
    state.drawPile.push(card('draw-good'));
    actInRound(state, 'b', { type: 'draw' }, 3); expect(state.intoxication?.targetUserId).toBe('b');
    actInRound(state, 'b', { type: 'pass' }, 4); expect(state.intoxication).toBeUndefined(); expect(state.turn).toBe(2);
    const other = intoxicate(); actInRound(other, 'b', { type: 'draw' }, 2);
    expect(other.intoxication).toBeUndefined(); expect(other.turn).toBe(2);
  });
  it('consumes the effect even when a two-player skip grants the same player another turn', () => {
    const state = round(); state.players.pop(); intoxicate(state);
    state.players[1]!.hand[0] = card('good', 'skip'); random.mockReturnValueOnce(1);
    actInRound(state, 'b', { type: 'play', cardId: 'good' }, 2);
    expect(state.players[state.turn]!.userId).toBe('b'); expect(state.intoxication).toBeUndefined();
    random.mockClear(); actInRound(state, 'b', { type: 'play', cardId: 'wild', color: 'sky' }, 3);
    expect(state.color).toBe('sky'); expect(random).not.toHaveBeenCalled();
  });
  it('conserves cards when the miss must recycle a scarce pile', () => {
    const state = intoxicate(); state.drawPile = []; const count = total(state);
    actInRound(state, 'b', { type: 'play', cardId: 'good' }, 2);
    expect(state.lastMove?.amount).toBe(1); expect(total(state)).toBe(count); expect(state.discard.at(-1)?.id).toBe('intoxicated');
  });
  it('negotiates a frozen deck and blocks old viewers/commands without blocking leave', () => {
    expect(room(false).view.game?.intoxicatedEnabled).toBe(false);
    const { rooms, table } = room(); expect(rooms.read('voice', 'a', true, true).supportsIntoxicated).toBe(true);
    expect(table.round.intoxicatedEnabled).toBe(true);
    expect(() => rooms.read('voice', 'watcher', true)).toThrow('juno_update_required');
    const view = rooms.read('voice', 'a', true, true);
    expect(() => rooms.command('voice', { userId: 'a', name: 'A' }, { type: 'draw', gameId: view.game!.id, revision: view.revision }, true)).toThrow('juno_update_required');
    expect(rooms.command('voice', { userId: 'a', name: 'A' }, { type: 'leave', gameId: view.game!.id, revision: view.revision }, true).game).toBeNull();
  });
  it('projects the wrong card only to the victim and rejects stale rerolls', () => {
    const { rooms, table } = room(); table.round = intoxicate();
    const before = rooms.read('voice', 'b', true, true);
    const command = { type: 'play' as const, cardId: 'good', gameId: before.game!.id, revision: before.revision };
    const victim = rooms.command('voice', { userId: 'b', name: 'B' }, command, true, true);
    expect(victim.game?.lastMove?.misplayedCard?.id).toBe('b-other');
    for (const id of ['a', 'c', 'watcher']) expect(JSON.stringify(rooms.read('voice', id, true, true))).not.toContain('b-other');
    const saved = JSON.stringify(table.round); expect(() => rooms.command('voice', { userId: 'b', name: 'B' }, command, true, true)).toThrow('juno_stale');
    expect(JSON.stringify(table.round)).toBe(saved);
  });
  it('clears status on timeout, departure and absolute expiry', () => {
    for (const end of ['timeout', 'leave', 'expiry'] as const) {
      const { rooms, table, setNow } = room(); table.round = intoxicate();
      if (end === 'leave') {
        const view = rooms.read('voice', 'b', true, true);
        rooms.command('voice', { userId: 'b', name: 'B' }, { type: 'leave', gameId: view.game!.id, revision: view.revision }, true, true);
      } else { setNow(end === 'timeout' ? 45_001 : 2 * 60 * 60_000); rooms.tick(); }
      expect(table.round.intoxication).toBeUndefined();
    }
  });
});
