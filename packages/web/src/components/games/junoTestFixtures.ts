import type { User } from '@veyvox/shared';
import type { JunoRankingPage, JunoView } from '@veyvox/shared/src/juno';

export function junoUser(id = 'a', name = id === 'a' ? 'Ada' : id === 'b' ? 'Bo' : id): User {
  return { id, username: id, displayName: name, avatar: null, banner: null, accentColor: null, avatarColor: null,
    bio: null, status: 'online', customStatus: null, isAdmin: false, createdAt: 1 };
}
export function junoGame(phase: JunoView['phase'] = 'lobby'): JunoView {
  return { id: 'game', phase, hostId: 'a', players: ['a', 'b'].map((id, i) => ({ userId: id, name: junoUser(id).displayName!, user: junoUser(id), cardCount: i === 0 ? 2 : 7, announced: false })),
    hand: phase === 'playing' ? [{ id: 'wild', color: null, face: 'wild' }, { id: 'number', color: 'sky', face: '8' }] : [],
    topCard: { id: 'top', color: 'coral', face: '3' }, color: 'coral', direction: 1, currentPlayerId: 'a',
    drawnCardId: null, remainingMs: 40000, winnerId: null, result: null, lastMove: null };
}
export function junoRanking(spaceId = 'space'): JunoRankingPage {
  return { spaceId, limit: 25, offset: 0, total: 0, entries: [],
    me: { user: junoUser(), nickname: null, rank: null, totalXp: 0, wins: 0, completedRounds: 0 } };
}
