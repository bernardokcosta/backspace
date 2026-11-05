import type { JunoPerson, JunoPlace, JunoStanding, JunoView } from '@backspace/shared/src/juno.js';

const XP_BY_PLACE: Record<JunoPlace, number> = { 1: 120, 2: 80, 3: 40, 4: 20 };

/** Freeze public counts, never private cards; absent starters abandoned the round. */
export function buildJunoStandings(
  starters: readonly JunoPerson[],
  finishers: readonly { userId: string; cardCount: number }[],
  winnerId: string | null,
  result: NonNullable<JunoView['result']>,
): JunoStanding[] {
  const ranked = result === 'emptyHand' && winnerId !== null;
  const rows: JunoStanding[] = starters.map(person => {
    const finisher = finishers.find(p => p.userId === person.userId);
    return { userId: person.userId, name: person.name, ...(person.computer ? { computer: person.computer } : {}), place: null, xp: 0,
      cardCount: finisher?.cardCount ?? null,
      outcome: !finisher ? 'abandoned' : ranked ? 'completed' : 'unranked' };
  });
  if (!ranked) return rows;
  const completed = rows.filter(r => r.outcome === 'completed').sort((a, b) =>
    a.userId === winnerId ? -1 : b.userId === winnerId ? 1 : a.cardCount! - b.cardCount!);
  for (let i = 0; i < completed.length; i++) {
    const row = completed[i]!; const previous = completed[i - 1];
    row.place = previous && row.cardCount === previous.cardCount ? previous.place : (i + 1) as JunoPlace;
    row.xp = XP_BY_PLACE[row.place!];
  }
  return [...completed, ...rows.filter(r => r.outcome !== 'completed')];
}
