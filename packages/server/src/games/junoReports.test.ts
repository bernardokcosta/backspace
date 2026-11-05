import { describe, expect, it } from 'vitest';
import { canPlayJuno, type JunoAction, type JunoCard } from '@backspace/shared/src/juno.js';
import { actInRound, JunoRooms, startRound, type JunoRound } from './juno.js';

const card = (id: string, face: JunoCard['face'] = '3', color: JunoCard['color'] = 'coral'): JunoCard => ({ id, face, color });
function round(): JunoRound {
  return { players: ['a', 'b', 'c'].map(userId => ({ userId, name: userId, announced: false,
    hand: [card(`${userId}-1`), card(`${userId}-2`)] })), drawPile: [card('d1'), card('d2'), card('d3')],
  discard: [card('top')], color: 'coral', direction: 1, turn: 0, drawnCardId: null, deadline: 45_000,
  winnerId: null, result: null, lastMove: null, blockedTurns: 0, reportWindows: [] };
}
const miss = (state: JunoRound, id = 'a', now = 100) => actInRound(state, id, { type: 'play', cardId: `${id}-1` }, now);
const report = (state: JunoRound, actor = 'c', now = 101) => actInRound(state, actor,
  { type: 'report', targetUserId: 'a', opportunityId: state.reportWindows.find(w => w.targetUserId === 'a')!.id }, now);

describe('participant-reported missed JUNO calls', () => {
  it('opens a unique ten-second opportunity but never draws automatically', () => {
    const state = round(); miss(state);
    expect(state.players[0]!.hand).toHaveLength(1);
    expect(state.reportWindows).toEqual([{ id: expect.any(String), targetUserId: 'a', deadline: 10_100 }]);
    actInRound(state, 'b', { type: 'play', cardId: 'b-1', announce: true }, 11_000);
    expect(state.players[0]!.hand).toHaveLength(1);
    expect(state.reportWindows).toEqual([]);
  });
  it('accepts another seated human out of turn at 9999ms without moving the turn or its timer', () => {
    const state = round(); miss(state); state.drawnCardId = 'b-2';
    const before = { turn: state.turn, deadline: state.deadline, top: state.discard.at(-1), color: state.color };
    const id = state.reportWindows[0]!.id; report(state, 'c', 10_099);
    expect(state.players[0]!.hand).toHaveLength(3); expect(state.reportWindows).toEqual([]);
    expect({ turn: state.turn, deadline: state.deadline, top: state.discard.at(-1), color: state.color }).toEqual(before);
    expect(state.drawnCardId).toBe('b-2');
    expect(state.lastMove).toMatchObject({ type: 'report', userId: 'c', targetUserId: 'a', amount: 2 });
    expect(() => actInRound(state, 'b', { type: 'report', targetUserId: 'a', opportunityId: id }, 10_099)).toThrow('juno_invalid_move');
    expect(state.players[0]!.hand).toHaveLength(3);
  });
  it('rejects a report at exactly ten seconds without a sweep or card changes', () => {
    const state = round(); miss(state); const before = JSON.stringify(state);
    expect(() => report(state, 'b', 10_100)).toThrow('juno_invalid_move'); expect(JSON.stringify(state)).toBe(before);
  });
  it.each(['a', 'watcher', 'bot'])('refuses an ineligible reporter %s', actor => {
    const state = round(); state.players[2]!.computer = 1; miss(state);
    if (actor === 'bot') state.players[2]!.userId = 'bot';
    const before = JSON.stringify(state);
    expect(() => report(state, actor)).toThrow(); expect(JSON.stringify(state)).toBe(before);
  });
  it('keeps simultaneous missed calls independent and refuses stale opportunity ids', () => {
    const state = round(); miss(state); const old = state.reportWindows[0]!.id;
    miss(state, 'b', 200); expect(state.reportWindows).toHaveLength(2);
    report(state); expect(state.reportWindows.map(w => w.targetUserId)).toEqual(['b']);
    state.turn = 0; state.players[0]!.hand = [card('a-1'), card('a-2')]; miss(state, 'a', 300);
    expect(state.reportWindows.find(w => w.targetUserId === 'a')!.id).not.toBe(old);
    expect(() => actInRound(state, 'c', { type: 'report', targetUserId: 'a', opportunityId: old }, 301)).toThrow('juno_invalid_move');
  });
  it('cancels a window when cards are gained, without damaging other windows', () => {
    const state = round(); miss(state); miss(state, 'b', 200);
    state.players[2]!.hand = [card('c-1', 'draw2'), card('c-2')]; miss(state, 'c', 300);
    expect(state.players[0]!.hand).toHaveLength(3);
    expect(state.reportWindows.map(w => w.targetUserId)).toEqual(['b', 'c']);
  });
  it('does not create a window for an accepted announcement and does not accept late repair', () => {
    const state = round(); actInRound(state, 'a', { type: 'announce' }, 99); miss(state);
    expect(state.reportWindows).toEqual([]);
    state.players[1]!.hand = [card('b-1', 'skip'), card('b-2')]; miss(state, 'b');
    expect(() => actInRound(state, 'b', { type: 'announce' }, 101)).toThrow();
  });
  it('allows an immediate last-card win and never reopens a finished round', () => {
    const state = round(); state.players = state.players.slice(0, 2); state.players[0]!.hand[0] = card('a-1', 'skip');
    miss(state); const id = state.reportWindows[0]!.id;
    actInRound(state, 'a', { type: 'play', cardId: 'a-2' }, 101);
    expect(state.result).toBe('emptyHand'); expect(state.winnerId).toBe('a'); expect(state.reportWindows).toEqual([]);
    expect(() => actInRound(state, 'b', { type: 'report', targetUserId: 'a', opportunityId: id }, 102)).toThrow();
  });
  it('recycles available cards and reports the actual amount without creating cards', () => {
    const state = round(); state.drawPile = []; miss(state);
    report(state); expect(state.players[0]!.hand).toHaveLength(2); expect(state.lastMove!.amount).toBe(1);
    expect(state.discard.map(c => c.id)).toEqual(['a-1']);
  });
  it('consumes a valid report once even if no cards remain available', () => {
    const state = round(); state.drawPile = []; miss(state);
    actInRound(state, 'b', { type: 'draw' }, 101); const id = state.reportWindows[0]!.id;
    report(state, 'c', 102);
    expect(state.lastMove).toMatchObject({ type: 'report', amount: 0 });
    expect(state.players[0]!.hand).toHaveLength(1); expect(state.reportWindows).toEqual([]);
    expect(() => actInRound(state, 'b', { type: 'report', targetUserId: 'a', opportunityId: id }, 103)).toThrow('juno_invalid_move');
  });
  it('can report the current player after a two-person skip without resetting its turn', () => {
    const state = round(); state.players = state.players.slice(0, 2); state.players[0]!.hand[0] = card('a-1', 'skip');
    miss(state); const deadline = state.deadline; expect(state.turn).toBe(0);
    report(state, 'b', 102);
    expect(state.turn).toBe(0); expect(state.deadline).toBe(deadline); expect(state.players[0]!.hand).toHaveLength(3);
  });
  it('conserves the complete deck across random plays and explicit reports', () => {
    const state = startRound(['a', 'b', 'c'].map(userId => ({ userId, name: userId })), 0);
    const inventory = () => [...state.drawPile, ...state.discard, ...state.players.flatMap(p => p.hand)].map(c => c.id).sort();
    const original = inventory();
    for (let i = 0; i < 1500 && !state.result; i++) {
      const window = state.reportWindows[0];
      if (window) actInRound(state, state.players.find(p => p.userId !== window.targetUserId)!.userId,
        { type: 'report', targetUserId: window.targetUserId, opportunityId: window.id }, i);
      else {
        const player = state.players[state.turn]!; const top = state.discard.at(-1)!;
        const playable = player.hand.find(c => (!state.drawnCardId || state.drawnCardId === c.id) && canPlayJuno(c, player.hand, top, state.color));
        actInRound(state, player.userId, playable ? { type: 'play', cardId: playable.id, color: 'mint' } : { type: state.drawnCardId ? 'pass' : 'draw' }, i);
      }
      expect(inventory()).toEqual(original);
    }
  });
});

describe('report projections and room lifecycle', () => {
  function setup() {
    let now = 0; const present = new Set(['a', 'b', 'c']);
    const rooms = new JunoRooms({ now: () => now, present: (_channel, id) => present.has(id), changed: () => {} });
    rooms.command('voice', { userId: 'a', name: 'A' }, { type: 'create' });
    const send = (id: string, action: JunoAction) => {
      const view = rooms.read('voice', id);
      return rooms.command('voice', { userId: id, name: id }, { ...action, gameId: view.game!.id, revision: view.revision });
    };
    send('b', { type: 'join' }); send('c', { type: 'join' }); send('a', { type: 'start' });
    for (let i = 0; i < 3000; i++) {
      const view = rooms.read('voice', 'a'); if (view.game!.reportOpportunities?.length) return { rooms, send, present, setTime: (value: number) => { now = value; } };
      const own = rooms.read('voice', view.game!.currentPlayerId!).game!;
      const playable = own.hand.find(c => (!own.drawnCardId || own.drawnCardId === c.id) && canPlayJuno(c, own.hand, own.topCard!, own.color!));
      send(own.currentPlayerId!, playable ? { type: 'play', cardId: playable.id, color: 'mint' } : { type: own.drawnCardId ? 'pass' : 'draw' });
    }
    throw new Error('No missed call encountered');
  }
  it('projects public ids/remaining time only, expires through reads and never draws on expiry', () => {
    const { rooms, setTime } = setup(); const view = rooms.read('voice', 'a');
    expect(view.game!.supportsReports).toBe(true);
    const opportunity = view.game!.reportOpportunities![0]!;
    expect(Object.keys(opportunity).sort()).toEqual(['id', 'remainingMs', 'targetUserId']);
    expect(opportunity.remainingMs).toBe(10_000); expect(rooms.read('voice', 'watcher').game!.hand).toEqual([]);
    setTime(9999); expect(rooms.read('voice', 'a').game!.reportOpportunities![0]!.remainingMs).toBe(1);
    setTime(10_000); const expired = rooms.read('voice', 'a');
    expect(expired.game!.reportOpportunities).toEqual([]); expect(expired.revision).toBeGreaterThan(view.revision);
    expect(expired.game!.players.find(p => p.userId === opportunity.targetUserId)!.cardCount).toBe(1);
  });
  it('cleans a departed target and keeps ordinary stale-command checks', () => {
    const { rooms, present } = setup(); const view = rooms.read('voice', 'a'); const opportunity = view.game!.reportOpportunities![0]!;
    const actor = view.game!.players.find(p => p.userId !== opportunity.targetUserId)!;
    present.delete(opportunity.targetUserId); rooms.tick(); expect(rooms.read('voice', actor.userId).game!.reportOpportunities).toEqual([]);
    expect(() => rooms.command('voice', actor, { type: 'report', targetUserId: opportunity.targetUserId, opportunityId: opportunity.id,
      gameId: view.game!.id, revision: view.revision })).toThrow('juno_stale');
  });
});
