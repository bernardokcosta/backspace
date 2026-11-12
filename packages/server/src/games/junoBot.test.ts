import { describe, expect, it, vi } from 'vitest';
import type { JunoAction, JunoCard } from '@veyvox/shared/src/juno.js';
import { chooseJunoBotAction } from './junoBot.js';
import { JunoRooms } from './juno.js';

const red: JunoCard = { id: 'red', color: 'coral', face: '3' };
describe('fair Juno computers', () => {
  it('plays the universal Entorpecido card without choosing a new active color', () => {
    const rare: JunoCard = { id: 'rare', color: null, face: 'intoxicated' };
    expect(chooseJunoBotAction([rare], red, 'coral', null)).toEqual({ type: 'play', cardId: 'rare', announce: true });
  });
  it('chooses from only its own hand, respects drawn-only play and selects a legal wild color', () => {
    const wild: JunoCard = { id: 'wild', color: null, face: 'wild' };
    const blue: JunoCard = { id: 'blue', color: 'sky', face: '8' };
    expect(chooseJunoBotAction([wild, red], red, 'coral', null)).toMatchObject({ type: 'play', cardId: 'red', announce: true });
    expect(chooseJunoBotAction([wild, red], red, 'coral', 'wild')).toMatchObject({ type: 'play', cardId: 'wild', color: 'coral' });
    expect(chooseJunoBotAction([red, blue], red, 'coral', 'blue')).toEqual({ type: 'pass' });
    expect(chooseJunoBotAction([blue], red, 'coral', null)).toEqual({ type: 'draw' });
    expect(chooseJunoBotAction([{ ...wild, face: 'draw4' }, red], red, 'coral', null)).toMatchObject({ cardId: 'red' });
  });
  function setup() {
    let now = 0; const present = new Set(['a', 'b']); const settle = vi.fn();
    const rooms = new JunoRooms({ now: () => now, present: (_channel, id) => present.has(id), changed: () => {}, settle, spaceIdForChannel: () => 'space' });
    rooms.command('voice', { userId: 'a', name: 'A' }, { type: 'create' });
    const send = (id: string, action: JunoAction) => {
      const view = rooms.read('voice', id);
      return rooms.command('voice', { userId: id, name: id }, { ...action, gameId: view.game!.id, revision: view.revision });
    };
    return { rooms, present, settle, send, advance: () => { now += 1000; rooms.tick(); } };
  }
  it('restricts computer management to the lobby host and leaves human seats alone', () => {
    const { rooms, send } = setup(); send('b', { type: 'join' });
    expect(() => send('b', { type: 'addBot' })).toThrow('juno_host_required');
    expect(() => send('a', { type: 'removeBot', botId: 'b' })).toThrow('juno_invalid_move');
    const old = send('a', { type: 'addBot' }); const cpu = old.game!.players.find(p => p.computer)!;
    expect(cpu.computer).toBe(1); expect(old.game!.practice).toBe(true);
    expect(() => rooms.command('voice', { userId: 'a', name: 'A' }, { type: 'addBot', gameId: old.game!.id, revision: old.revision - 1 })).toThrow('juno_stale');
    send('a', { type: 'addBot' }); expect(() => send('a', { type: 'addBot' })).toThrow('juno_full');
    send('a', { type: 'removeBot', botId: cpu.userId });
    send('a', { type: 'start' }); expect(() => send('a', { type: 'addBot' })).toThrow('juno_in_progress');
    expect(rooms.read('voice', 'watcher').game!.hand).toEqual([]);
  });
  it('never gives a guessed computer id a hand or a turn command, or lets it inherit hosting', () => {
    const { rooms, send, present } = setup(); send('a', { type: 'addBot' }); send('b', { type: 'join' });
    const bot = rooms.read('voice', 'a').game!.players.find(p => p.computer)!;
    send('a', { type: 'start' }); expect(rooms.read('voice', bot.userId).game!.hand).toEqual([]);
    expect(() => send(bot.userId, { type: 'draw' })).toThrow('juno_player_required');
    present.delete('a'); rooms.tick(); expect(rooms.read('voice', 'b').game!.hostId).toBe('b');
    present.delete('b'); rooms.tick(); expect(rooms.read('voice', 'watcher').game).toBeNull();
  });
  it('paces complete practice rounds without giving anyone XP or invoking settlement', () => {
    const { rooms, send, advance, settle } = setup();
    for (let i = 0; i < 3; i++) send('a', { type: 'addBot' });
    send('a', { type: 'start' });
    for (let i = 0; i < 5000; i++) {
      const view = rooms.read('voice', 'a').game!;
      if (view.phase === 'finished') break;
      if (view.currentPlayerId === 'a') send('a', chooseJunoBotAction(view.hand, view.topCard!, view.color!, view.drawnCardId));
      else {
        const before = rooms.read('voice', 'a').revision;
        for (let n = 0; n < 10; n++) expect(rooms.read('voice', 'a').revision).toBe(before);
        advance();
      }
    }
    const done = rooms.read('voice', 'a').game!;
    expect(done.phase).toBe('finished'); expect(done.practice).toBe(true);
    expect(done.scoreboard).toMatchObject({ status: 'unranked' });
    expect(done.scoreboard!.standings.every(row => row.xp === 0)).toBe(true);
    expect(done.scoreboard!.standings.some(row => row.place === 1)).toBe(true);
    expect(settle).not.toHaveBeenCalled();
    send('a', { type: 'rematch' });
    expect(rooms.read('voice', 'a').game).toMatchObject({ practice: false, players: [{ userId: 'a' }] });
  });
});
