import { describe, expect, it } from 'vitest';
import type { JunoFace, JunoView } from '@veyvox/shared/src/juno';
import { JUNO_SOUNDS, junoMoveSounds } from './junoSoundCues';
import { junoGame } from './junoTestFixtures';

const previous = (): JunoView => ({ ...junoGame('playing'), currentPlayerId: 'b' });
function play(face: JunoFace): JunoView {
  return { ...previous(), remainingMs: 45_000, lastMove: { id: 'new', type: 'play', userId: 'b', card: { id: 'card', color: null, face } } };
}
describe('Juno neon cue selection', () => {
  it.each([['8', 'play'], ['draw2', 'draw2'], ['draw4', 'draw4'], ['reverse', 'reverse'], ['skip', 'skip'], ['wild', 'wild'], ['memory', 'memory'], ['intoxicated', 'intoxicated']] as const)
    ('selects %s without layering an ordinary play', (face, cue) => {
      expect(junoMoveSounds(previous(), play(face), 'a')).toEqual([cue]);
    });
  it('deduplicates polls, old playing turns and different rounds', () => {
    const next = play('8');
    expect(junoMoveSounds(next, next, 'a')).toEqual([]);
    expect(junoMoveSounds(previous(), { ...next, remainingMs: 41_999 }, 'a')).toEqual([]);
    expect(junoMoveSounds(previous(), { ...next, id: 'elsewhere' }, 'a')).toEqual([]);
    expect(junoMoveSounds(previous(), { ...next, lastMove: { ...next.lastMove!, id: undefined } }, 'a')).toEqual([]);
  });
  it('sounds start and the local turn, not a spectator turn or a continued turn', () => {
    const next = { ...play('8'), currentPlayerId: 'a', lastMove: { id: 'start', type: 'start' as const, userId: 'a' } };
    expect(junoMoveSounds(junoGame(), next, 'a')).toEqual(['shuffle', 'turn']);
    expect(junoMoveSounds(junoGame(), next, 'c')).toEqual(['shuffle']);
    expect(junoMoveSounds({ ...previous(), currentPlayerId: 'a' }, { ...play('8'), currentPlayerId: 'a' }, 'a')).toEqual(['play']);
  });
  it('sounds only successful draws/reports and local memory misses', () => {
    const next = play('8');
    for (const type of ['draw', 'timeout', 'report'] as const) {
      expect(junoMoveSounds(previous(), { ...next, lastMove: { id: type, type, userId: 'b', amount: 2 } }, 'a')).toEqual([type === 'report' ? 'report' : 'draw']);
      expect(junoMoveSounds(previous(), { ...next, lastMove: { id: type, type, userId: 'b', amount: 0 } }, 'a')).toEqual([]);
    }
    const miss = { ...next, lastMove: { id: 'miss', type: 'memory_miss' as const, userId: 'a', amount: 2 } };
    expect(junoMoveSounds(previous(), miss, 'a')).toEqual(['invalid']);
    expect(junoMoveSounds(previous(), miss, 'b')).toEqual(['draw']);
  });
  it('does not repeat an explicit announcement on the following play', () => {
    const next = play('8'); next.lastMove!.announced = true;
    expect(junoMoveSounds(previous(), next, 'a')).toEqual(['play', 'announce']);
    const announced = previous(); announced.players = announced.players.map(p => ({ ...p, announced: p.userId === 'b' }));
    expect(junoMoveSounds(announced, next, 'a')).toEqual(['play']);
    expect(junoMoveSounds(previous(), { ...next, lastMove: { id: 'juno', type: 'announce', userId: 'b' } }, 'a')).toEqual(['announce']);
  });
  it('allows fresh draw/announce/report events late in the same turn (they do not reset the deadline)', () => {
    const next = { ...play('8'), remainingMs: 10_000 };
    for (const [type, cue] of [['draw', 'draw'], ['announce', 'announce'], ['report', 'report']] as const) {
      expect(junoMoveSounds(previous(), { ...next, lastMove: { id: type, type, userId: 'b', amount: 2 } }, 'a')).toEqual([cue]);
    }
  });
  it.each(['draw', 'memory_miss', 'intoxicated_miss'] as const)('rejects stale %s that advanced the turn, including its turn alert', type => {
    const next = { ...previous(), remainingMs: 10_000, currentPlayerId: 'a', lastMove: { id: 'old', type, userId: 'b', amount: 2 } };
    expect(junoMoveSounds(previous(), next, 'a')).toEqual([]);
    expect(junoMoveSounds(previous(), next, 'b')).toEqual([]);
    expect(junoMoveSounds(previous(), { ...next, remainingMs: 45_000 }, 'a')).toEqual(['draw', 'turn']);
    expect(junoMoveSounds(previous(), { ...next, remainingMs: 45_000 }, 'b')).toEqual([type === 'draw' ? 'draw' : 'invalid']);
  });
  it('detects an advanced draw from its actor even when intervening moves were missed', () => {
    const before = { ...previous(), currentPlayerId: 'a' };
    const next = { ...before, remainingMs: 10_000, lastMove: { id: 'old-draw', type: 'draw' as const, userId: 'b', amount: 1 } };
    expect(junoMoveSounds(before, next, 'a')).toEqual([]);
  });
  it('sounds a live terminal transition with zero remaining time once, never for spectators or no winner', () => {
    const next = { ...play('8'), phase: 'finished' as const, winnerId: 'a', remainingMs: 0 };
    expect(junoMoveSounds(previous(), next, 'a')).toEqual(['victory']);
    expect(junoMoveSounds(previous(), next, 'b')).toEqual(['defeat']);
    expect(junoMoveSounds(previous(), next, 'c')).toEqual([]);
    expect(junoMoveSounds(next, next, 'a')).toEqual([]);
    expect(junoMoveSounds(previous(), { ...next, winnerId: null }, 'a')).toEqual([]);
  });
  it('has exactly 16 pack files plus two supplied rare-card cues with bounded gains/lanes', () => {
    expect(Object.keys(JUNO_SOUNDS)).toHaveLength(18);
    expect(JUNO_SOUNDS.memory).toMatchObject({ sound: 'juno_memory', gain: 1 });
    expect(JUNO_SOUNDS.intoxicated).toMatchObject({ sound: 'juno_intoxicated', gain: 1 });
    expect(JUNO_SOUNDS.button).toMatchObject({ sound: 'juno/botao', gain: .35, lane: 'interface' });
    expect(new Set(Object.values(JUNO_SOUNDS).map(cue => cue.sound)).size).toBe(18);
  });
});
