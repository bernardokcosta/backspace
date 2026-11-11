import type { User } from '@veyvox/shared';
import { useSpaceStore, type UserViewEntry } from '../stores/spaceStore';

/** Reuse the cached native profile object; a miss leaves the supplied row intact. */
export function canonicalUserViewIn<T extends Pick<User, 'id'>>(userViews: ReadonlyMap<string, UserViewEntry>, row: T): User | T {
  return userViews.get(row.id)?.user ?? row;
}
export function getCanonicalUserView<T extends Pick<User, 'id'>>(row: T): User | T {
  return canonicalUserViewIn(useSpaceStore.getState().userViews, row);
}
/** Subscribe only to this native account, preserving memoized row identities. */
export function useCanonicalUserView<T extends Pick<User, 'id'>>(row: T): User | T {
  const entry = useSpaceStore(state => state.userViews.get(row.id));
  return entry?.user ?? row;
}
