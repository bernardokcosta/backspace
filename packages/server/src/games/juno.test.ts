import { describe, expect, it, vi } from 'vitest';
import { JUNO_TURN_MS, canPlayJuno, type JunoAction, type JunoCard } from '@backspace/shared/src/juno.js';
import { createJunoDeck, JunoRooms, startRound, actInRound, type JunoRound } from './juno.js';

const card = (id: string, face: JunoCard['face'] = '3', color: JunoCard['color'] = 'coral'): JunoCard => ({ id, face, color });
function round(count = 3): JunoRound {
  return {
    players: Array.from({ length: count }, (_, i) => ({ userId: String(i), name: String(i), hand: [card(`a${i}`), card(`b${i}`, '5', 'sky'), card(`c${i}`, '8', 'mint')], announced: false })),
    drawPile: Array.from({ length: 30 }, (_, i) => card(`d${i}`, '9', 'amber')),
    discard: [card('top')], color: 'coral', direction: 1, turn: 0, drawnCardId: null,
    deadline: 45_000, winnerId: null, result: null, lastMove: null, blockedTurns: 0,
  };
}
describe('Juno authoritative rules', () => {
  it('builds 108 unique cards and deals seven with a numeric first discard', () => {
    const deck = createJunoDeck();
    expect(deck).toHaveLength(108); expect(new Set(deck.map(c => c.id)).size).toBe(108);
    expect(deck.filter(c => c.face === 'draw4')).toHaveLength(4);
    const state = startRound([{ userId: 'a', name: 'A' }, { userId: 'b', name: 'B' }], 0);
    expect(state.players.every(p => p.hand.length === 7)).toBe(true);
    expect(state.discard[0]?.face).toMatch(/^\d$/);
    expect(state.drawPile.length + 15).toBe(108);
  });
  it('refuses out-of-turn, unowned and illegal cards without mutations', () => {
    const state = round(); const before = JSON.stringify(state);
    expect(() => actInRound(state, '1', { type: 'draw' }, 0)).toThrow('juno_not_your_turn');
    expect(() => actInRound(state, '0', { type: 'play', cardId: 'a1' }, 0)).toThrow('juno_invalid_move');
    expect(() => actInRound(state, '0', { type: 'play', cardId: 'b0' }, 0)).toThrow('juno_invalid_move');
    expect(JSON.stringify(state)).toBe(before);
  });
  it.each([['skip', 2, 1], ['reverse', 2, -1], ['draw2', 2, 1]] as const)('applies %s', (face, turn, direction) => {
    const state = round(); state.players[0]!.hand[0] = card('special', face);
    actInRound(state, '0', { type: 'play', cardId: 'special' }, 0);
    expect(state.turn).toBe(turn); expect(state.direction).toBe(direction);
    if (face === 'draw2') expect(state.players[1]!.hand).toHaveLength(5);
  });
  it('reverse acts as skip with two players', () => {
    const state = round(2); state.players[0]!.hand[0] = card('r', 'reverse');
    actInRound(state, '0', { type: 'play', cardId: 'r' }, 0); expect(state.turn).toBe(0);
  });
  it('requires a wild color and forbids +4 while holding the active color', () => {
    const state = round(); state.players[0]!.hand.push(card('wild', 'draw4', null));
    expect(() => actInRound(state, '0', { type: 'play', cardId: 'wild', color: 'sky' }, 0)).toThrow('juno_invalid_move');
    state.players[0]!.hand = [card('wild', 'draw4', null), card('other', '2', 'mint')];
    expect(() => actInRound(state, '0', { type: 'play', cardId: 'wild' }, 0)).toThrow('juno_invalid_move');
    actInRound(state, '0', { type: 'play', cardId: 'wild', color: 'sky', announce: true }, 0);
    expect(state.color).toBe('sky'); expect(state.players[1]!.hand).toHaveLength(7); expect(state.turn).toBe(2);
  });
  it('allows only the drawn card after drawing; pass cannot precede a draw', () => {
    const state = round(); state.drawPile.push(card('new', '3', 'sky'));
    expect(() => actInRound(state, '0', { type: 'pass' }, 0)).toThrow('juno_invalid_move');
    actInRound(state, '0', { type: 'draw' }, 0); expect(state.drawnCardId).toBe('new');
    expect(() => actInRound(state, '0', { type: 'draw' }, 0)).toThrow('juno_invalid_move');
    expect(() => actInRound(state, '0', { type: 'play', cardId: 'a0' }, 0)).toThrow('juno_invalid_move');
    actInRound(state, '0', { type: 'play', cardId: 'new' }, 0); expect(state.turn).toBe(1);
  });
  it('automatically passes after drawing an unplayable card', () => {
    const state = round(); actInRound(state, '0', { type: 'draw' }, 0); expect(state.turn).toBe(1);
  });
  it.each([true, false])('announcing Juno = %s controls the two-card penalty', announce => {
    const state = round(); state.players[0]!.hand.pop();
    actInRound(state, '0', { type: 'play', cardId: 'a0', announce }, 0);
    expect(state.players[0]!.hand).toHaveLength(announce ? 1 : 3);
    expect(state.players[0]!.announced).toBe(announce);
  });
  it('applies final-card penalties before recording a winner', () => {
    const state = round(); state.players[0]!.hand = [card('last', 'draw2')];
    actInRound(state, '0', { type: 'play', cardId: 'last' }, 0);
    expect(state.winnerId).toBe('0'); expect(state.players[1]!.hand).toHaveLength(5);
  });
  it('recycles discards without drawing the top card and conserves the deck', () => {
    const state = round(); state.drawPile = []; state.discard.unshift(card('recycled', '9', 'sky'));
    actInRound(state, '0', { type: 'draw' }, 0);
    expect(state.players[0]!.hand.some(c => c.id === 'recycled')).toBe(true);
    expect(state.discard.map(c => c.id)).toEqual(['top']);
  });
  it('ends a blocked full cycle instead of hanging forever', () => {
    const state = round(); state.drawPile = [];
    for (const p of state.players) p.hand = [card(`blocked${p.userId}`, '9', 'sky')];
    for (const p of state.players) actInRound(state, p.userId, { type: 'draw' }, 0);
    expect(state.result).toBe('stalemate');
  });
  it.each([2, 3, 4])('completes randomized %s-player rounds while conserving every card', count => {
    for (let sample = 0; sample < 20; sample++) {
      const state = startRound(Array.from({ length: count }, (_, i) => ({ userId: String(i), name: String(i) })), 0);
      const original = new Set([...state.drawPile, ...state.discard, ...state.players.flatMap(p => p.hand)].map(c => c.id));
      let moves = 0;
      while (!state.result && moves++ < 5_000) {
        const player = state.players[state.turn]!;
        const playable = player.hand.find(c => (!state.drawnCardId || c.id === state.drawnCardId) && canPlayJuno(c, player.hand, state.discard.at(-1)!, state.color));
        actInRound(state, player.userId, playable ? { type: 'play', cardId: playable.id, color: 'mint', announce: true }
          : { type: state.drawnCardId ? 'pass' : 'draw' }, moves);
        const cards = [...state.drawPile, ...state.discard, ...state.players.flatMap(p => p.hand)];
        expect(cards).toHaveLength(108); expect(new Set(cards.map(c => c.id))).toEqual(original);
      }
      expect(state.result).toBeTruthy();
    }
  });
});

describe('Juno rooms, privacy and lifecycle', () => {
  function setup() {
    let now = 0; const seated = new Set(['a', 'b', 'c', 'd', 'e']); const changed = vi.fn();
    const rooms = new JunoRooms({ present: (_channel, id) => seated.has(id), changed, now: () => now });
    const send = (id: string, action: JunoAction) => {
      const snapshot = rooms.read('voice', id);
      return rooms.command('voice', { userId: id, name: id }, { ...action, gameId: snapshot.game!.id, revision: snapshot.revision });
    };
    rooms.command('voice', { userId: 'a', name: 'a' }, { type: 'create' });
    return { rooms, seated, changed, send, setTime: (value: number) => { now = value; } };
  }
  it('caps seats at four, rejects late joins, and never serializes hidden cards', () => {
    const { rooms, send } = setup(); for (const id of ['b', 'c', 'd']) send(id, { type: 'join' });
    expect(() => send('e', { type: 'join' })).toThrow('juno_full');
    send('a', { type: 'start' }); const a = rooms.read('voice', 'a'); const b = rooms.read('voice', 'b');
    expect(a.game!.hand).toHaveLength(7); expect(rooms.read('voice', 'e').game!.hand).toEqual([]);
    for (const c of b.game!.hand) expect(JSON.stringify(a)).not.toContain(`"${c.id}"`);
    expect(() => send('e', { type: 'join' })).toThrow('juno_in_progress');
  });
  it('rejects repeated commands and non-host starts', () => {
    const { rooms, send } = setup(); send('b', { type: 'join' });
    expect(() => send('b', { type: 'start' })).toThrow('juno_host_required');
    const old = rooms.read('voice', 'a'); send('a', { type: 'start' });
    expect(() => rooms.command('voice', { userId: 'a', name: 'a' }, { type: 'start', gameId: old.game!.id, revision: old.revision })).toThrow('juno_stale');
  });
  it('automatically draws/passes expired turns and removes departed players', () => {
    const { rooms, send, setTime, seated } = setup(); send('b', { type: 'join' }); send('c', { type: 'join' }); send('a', { type: 'start' });
    setTime(JUNO_TURN_MS); rooms.tick(); expect(rooms.read('voice', 'b').game!.currentPlayerId).toBe('b');
    seated.delete('b'); rooms.tick(); expect(rooms.read('voice', 'c').game!.currentPlayerId).toBe('c');
    seated.delete('a'); rooms.tick(); expect(rooms.read('voice', 'c').game).toMatchObject({ hostId: 'c', phase: 'finished', result: 'playersLeft' });
    seated.delete('c'); rooms.tick(); expect(rooms.read('voice', 'c').game).toBeNull();
  });
  it('expires idle lobbies and supports disposal', () => {
    const { rooms, setTime } = setup(); setTime(15 * 60_000); rooms.tick();
    expect(rooms.read('voice', 'a').game).toBeNull(); rooms.dispose();
  });
});
