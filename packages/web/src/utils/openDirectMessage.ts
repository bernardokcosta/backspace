import { api } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { useSpaceStore } from '../stores/spaceStore';

/** Reuse the native pair, or create it once through the current authenticated API. */
export async function openDirectMessage(userId: string): Promise<string> {
  const store = useSpaceStore.getState();
  const existing = store.findExistingDmForUser(userId);
  if (existing) return existing.id;
  const revision = useAuthStore.getState().sessionRevision;
  const channel = await api.dm.create({ userId });
  if (revision !== useAuthStore.getState().sessionRevision) throw new DOMException('Session changed', 'AbortError');
  return store.upsertDmChannel(channel);
}
