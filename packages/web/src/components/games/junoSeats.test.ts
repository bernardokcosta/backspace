import { describe, expect, it } from 'vitest';
import { junoSeats } from './junoSeats';
const people = ['a', 'b', 'c', 'd'].map(userId => ({ userId, name: userId }));
describe('Juno table seat layout', () => {
  it('keeps the viewer below and opponents in fixed relative positions', () => {
    const seats = junoSeats(people, 'c'); expect(seats.bottom?.userId).toBe('c');
    expect(new Set(Object.values(seats).map(p => p?.userId)).size).toBe(4);
    expect(junoSeats(people, 'c')).toEqual(seats);
  });
  it('leaves real empty seats with two players', () => {
    const seats = junoSeats(people.slice(0, 2), 'a');
    expect(seats.top?.userId).toBe('b'); expect(seats.bottom?.userId).toBe('a');
    expect(seats.left).toBeNull(); expect(seats.right).toBeNull();
  });
  it('does not invent a player for a spectator', () => {
    const seats = junoSeats(people.slice(0, 3), 'watcher');
    expect(Object.values(seats).filter(Boolean)).toHaveLength(3);
    expect(seats.bottom).toBeNull();
  });
});
