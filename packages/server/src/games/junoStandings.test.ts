import { describe, expect, it } from 'vitest';
import { buildJunoStandings } from './junoStandings.js';

const starters = ['a', 'b', 'c', 'd'].map(userId => ({ userId, name: userId }));
describe('Juno final standings', () => {
  it('ranks [0,2,2,7] as [1,2,2,4] and awards [120,80,80,20]', () => {
    const rows = buildJunoStandings(starters, [0, 2, 2, 7].map((cardCount, i) => ({ userId: starters[i]!.userId, cardCount })), 'a', 'emptyHand');
    expect(rows.map(r => r.place)).toEqual([1, 2, 2, 4]);
    expect(rows.map(r => r.xp)).toEqual([120, 80, 80, 20]);
  });
  it.each([2, 3])('awards only %s actual finishers and keeps inputs immutable', count => {
    const people = starters.slice(0, count); const before = JSON.stringify(people);
    const rows = buildJunoStandings(people, people.map((p, i) => ({ userId: p.userId, cardCount: i * 2 })), 'a', 'emptyHand');
    expect(rows.map(r => r.xp)).toEqual([120, 80, 40].slice(0, count));
    rows[0]!.name = 'changed'; expect(JSON.stringify(people)).toBe(before);
  });
  it('retains abandoned starters without reserving a ranked place', () => {
    const rows = buildJunoStandings(starters, [{ userId: 'a', cardCount: 0 }, { userId: 'c', cardCount: 5 }], 'a', 'emptyHand');
    expect(rows.filter(r => r.outcome === 'completed').map(r => [r.userId, r.place, r.xp])).toEqual([['a', 1, 120], ['c', 2, 80]]);
    expect(rows.find(r => r.userId === 'b')).toMatchObject({ outcome: 'abandoned', place: null, xp: 0, cardCount: null });
  });
  it.each(['playersLeft', 'stalemate', 'expired'] as const)('never awards a %s round', result => {
    const rows = buildJunoStandings(starters, starters.map(p => ({ userId: p.userId, cardCount: 4 })), null, result);
    expect(rows.every(r => r.xp === 0 && r.place === null && r.outcome === 'unranked')).toBe(true);
  });
});
