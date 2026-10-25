import { useSyncExternalStore } from 'react';
import type { InstanceInfoResponse } from '@backspace/shared';
import { api } from '../api/client';

/**
 * The home instance's public info (`GET /api/instance/info`), shared by
 * sticker upload/management and invalidated after instance settings saves.
 *
 * Fetch rule: whenever a subscriber mounts while there is no fresh value and
 * no request in flight, one request starts on the home API client and every
 * concurrent subscriber shares it. A success is cached for the session. A
 * failure leaves the value as it was (null, or the stale value) and nothing
 * in flight, and nothing retries on a timer: the next subscriber mount
 * tries again.
 *
 * Invalidation is stale-while-revalidate: the last value stays on screen,
 * marked stale, until the reread replaces it, so sticker limits do not
 * disappear after an admin save.
 *
 * Other readers (settings, auth and admin panels) keep their own requests.
 */

let cached: InstanceInfoResponse | null = null;
/** Set by an invalidation; the cached value is still shown but is reread. */
let stale = false;
let inFlight = false;
/**
 * Bumped by every invalidation. A request remembers the generation it started
 * in and drops its answer if that has moved on, so a response already in
 * flight when an admin saved cannot land the pre-save values over the reread.
 */
let generation = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function fetchIfNeeded(): void {
  if (inFlight || (cached !== null && !stale)) return;
  if (!api.instance?.info) return;
  const startedIn = generation;
  inFlight = true;
  api.instance.info().then(
    (info) => {
      if (startedIn !== generation) return;
      cached = info;
      stale = false;
      inFlight = false;
      emit();
    },
    () => {
      if (startedIn !== generation) return;
      inFlight = false;
    },
  );
}

/**
 * Subscribing is mounting, so this is where the fetch rule runs. React calls
 * it once per mounted subscriber; the stable module-level identity means it is
 * not called again on re-render.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  fetchIfNeeded();
  return () => { listeners.delete(listener); };
}

function getSnapshot(): InstanceInfoResponse | null {
  return cached;
}

export function useHomeInstanceInfo(): InstanceInfoResponse | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Marks the cached info stale and, if anything is subscribed, rereads it at
 * once. The stale value stays visible until the reread succeeds, and stays if
 * it fails; with nothing subscribed the next mount rereads. `GeneralPanel`
 * calls this after a successful save, so turning the Support card off shows
 * on the page without a reload.
 */
export function invalidateHomeInstanceInfo(): void {
  generation += 1;
  stale = true;
  inFlight = false;
  if (listeners.size > 0) fetchIfNeeded();
}

/** Test-only: forget everything, including subscribers a failed test left behind. */
export function __resetHomeInstanceInfoForTests(): void {
  generation += 1;
  cached = null;
  stale = false;
  inFlight = false;
  listeners.clear();
}
