import type { JunoPerson } from '@backspace/shared/src/juno';

export function junoSeats<T extends JunoPerson>(players: readonly T[], selfId?: string): Record<'top' | 'left' | 'right' | 'bottom', T | null> {
  const seats: Record<'top' | 'left' | 'right' | 'bottom', T | null> = { top: null, left: null, right: null, bottom: null };
  const index = players.findIndex(p => p.userId === selfId);
  if (index < 0) return { top: players[0] ?? null, left: players[1] ?? null, right: players[2] ?? null, bottom: players[3] ?? null };
  seats.bottom = players[index]!;
  const opponents = [...players.slice(index + 1), ...players.slice(0, index)];
  if (opponents.length === 1) seats.top = opponents[0]!;
  else if (opponents.length === 2) { seats.left = opponents[0]!; seats.right = opponents[1]!; }
  else { seats.left = opponents[0] ?? null; seats.top = opponents[1] ?? null; seats.right = opponents[2] ?? null; }
  return seats;
}
