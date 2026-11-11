import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { describeError } from '../i18n/errors';
import { permissionsToString, overrideVersion } from '../utils/permissions';
import {
  findOverride,
  overrideBitsOf,
  withOverrideBits,
  type OverrideBitState,
  type OverrideWrite,
  type StoredOverride,
} from '../utils/overrideBits';

/** Which kind of entity carries the overrides: the two share one route shape. */
export type OverrideEntityKind = 'channel' | 'category';

export interface EntityOverrides {
  /** The overrides as the server last listed them. */
  overrides: StoredOverride[];
  /** False until the first listing has come back (or failed). */
  loaded: boolean;
  /** Why the last listing failed, in the user's language; empty when it did not. */
  error: string;
  /** List the overrides again. */
  reload: () => Promise<void>;
  /**
   * Write one whole override row, made from the row whose version it names;
   * rejects with `overrides_conflict` when the stored row has changed since.
   */
  put: (row: OverrideWrite) => Promise<unknown>;
  /** Remove one override row, as loaded at `version`; rejects with `overrides_conflict` when it has changed since. */
  remove: (targetType: string, targetId: string, version: string) => Promise<unknown>;
  /**
   * Put `bits` of one target's override in `state` and leave every other bit
   * of it alone: the row is written with the change, or removed when nothing
   * is left on it. Then the list is read again. Rejects with the server's
   * error when the write is refused, `overrides_conflict` when the row
   * changed after this list was read.
   */
  setBits: (targetType: string, targetId: string, bits: bigint, state: OverrideBitState) => Promise<void>;
}

/**
 * Native overrides of one channel or category. One list per open settings dialog: every tab and
 * control of it reads and edits this list, so none of them holds a copy that
 * can go stale. `enabled` false (the viewer cannot read overrides) fetches
 * nothing.
 */
export function useEntityOverrides(
  kind: OverrideEntityKind,
  entityId: string | undefined,
  enabled: boolean,
): EntityOverrides {
  const [overrides, setOverrides] = useState<StoredOverride[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  // Only the newest listing may land; an older one answering late would put
  // back what a write just changed.
  const requestSeq = useRef(0);
  const revision = useAuthStore(s => s.sessionRevision);
  const owner = useRef({ kind, entityId, enabled, revision });
  owner.current = { kind, entityId, enabled, revision };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const owned = useCallback(() => mounted.current && revision === useAuthStore.getState().sessionRevision
    && owner.current.revision === revision && owner.current.kind === kind && owner.current.entityId === entityId
    && owner.current.enabled === enabled, [kind, entityId, enabled, revision]);
  const routes = kind === 'channel' ? api.channels : api.categories;

  const reload = useCallback(async (): Promise<void> => {
    if (!entityId || !enabled || !owned()) return;
    const seq = ++requestSeq.current;
    try {
      const rows = await routes.getOverrides(entityId);
      if (seq !== requestSeq.current || !owned()) return;
      setOverrides(rows.map(({ targetType, targetId, allow, deny }) => ({ targetType, targetId, allow, deny })));
      setError('');
    } catch (err) {
      if (seq !== requestSeq.current || !owned()) return;
      setError(describeError(err));
    } finally {
      if (seq === requestSeq.current && owned()) setLoaded(true);
    }
  }, [entityId, enabled, routes, owned]);

  useEffect(() => {
    requestSeq.current++;
    setOverrides([]);
    setError('');
    // Nothing to wait for when there is nothing to fetch.
    setLoaded(!entityId || !enabled);
    void reload();
  }, [reload, entityId, enabled]);

  const put = useCallback(async (row: OverrideWrite) => {
    if (!entityId || !enabled || !owned()) throw new DOMException('Settings target changed', 'AbortError');
    const saved = await routes.putOverride(entityId, row);
    if (!owned()) throw new DOMException('Settings target changed', 'AbortError');
    return saved;
  }, [entityId, enabled, routes, owned]);

  const remove = useCallback(async (targetType: string, targetId: string, version: string) => {
    if (!entityId || !enabled || !owned()) throw new DOMException('Settings target changed', 'AbortError');
    const saved = await routes.deleteOverride(entityId, targetType, targetId, version);
    if (!owned()) throw new DOMException('Settings target changed', 'AbortError');
    return saved;
  }, [entityId, enabled, routes, owned]);

  const setBits = useCallback(async (targetType: string, targetId: string, bits: bigint, state: OverrideBitState) => {
    const loaded = findOverride(overrides, targetType, targetId);
    const current = overrideBitsOf(loaded);
    const next = withOverrideBits(current, bits, state);
    // The change is made to the row as this list holds it, so it names that
    // row's version: a row changed meanwhile is refused, not overwritten.
    const version = overrideVersion(loaded);
    try {
      if (next) {
        await put({ targetType, targetId, allow: permissionsToString(next.allow), deny: permissionsToString(next.deny), version });
      } else if (current) {
        await remove(targetType, targetId, version);
      }
    } finally {
      await reload();
    }
  }, [overrides, put, remove, reload]);

  return { overrides, loaded, error, reload, put, remove, setBits };
}
