import { create } from 'zustand';
import type { JunoAction, JunoCommand, JunoSnapshot, JunoRankingPage } from '@veyvox/shared/src/juno';
import { getApiForOrigin } from '../utils/crossStoreResolvers';
import { HttpError, RateLimitError } from '../api/client';

export interface JunoTarget { accountId: string; origin: string; channelId: string; selfId: string }
export interface JunoRankingTarget { accountId: string; origin: string; spaceId: string; selfId: string }
interface RankingState { target: JunoRankingTarget | null; page: JunoRankingPage | null; loading: boolean; error: unknown; unsupported: boolean }
const emptyRanking = (): RankingState => ({ target: null, page: null, loading: false, error: null, unsupported: false });
interface JunoState {
  target: JunoTarget | null;
  connected: boolean;
  hosts: Record<string, boolean>;
  snapshot: JunoSnapshot | null;
  observedAt: number;
  loading: boolean;
  pending: boolean;
  stale: boolean;
  error: unknown;
  open: boolean;
  /** Token leases attest actual large table views; never persisted or inferred from open. */
  presentedViews: ReadonlySet<symbol>;
  presentView: (target: JunoTarget) => () => void;
  ranking: RankingState;
  loadRanking: (target: JunoRankingTarget, query?: { limit?: number; offset?: number }) => Promise<void>;
  clearRanking: () => void;
  setOpen: (open: boolean) => void;
  setHost: (origin: string, supported: boolean) => void;
  bind: (target: JunoTarget | null, connected: boolean) => void;
  load: () => Promise<void>;
  command: (action: JunoAction | { type: 'create' }) => Promise<void>;
  invalidate: (origin: string, channelId: string) => void;
  reset: () => void;
}
let epoch = 0;
let readRun = 0;
let rankingRun = 0;
interface ReadFlight { epoch: number; dirty: boolean; promise: Promise<void> }
let readFlight: ReadFlight | null = null;
let retryAt = 0;
let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
function cancelRecovery(): void {
  clearTimeout(recoveryTimer); recoveryTimer = undefined;
  retryAt = 0; readFlight = null;
}
function inaccessible(error: unknown): boolean {
  return error instanceof HttpError && (error.status === 401 || error.status === 403 || error.status === 404 || error.code === 'juno_update_required');
}
function discardPrivateState(): void {
  epoch++; readRun++; cancelRecovery();
  useJunoStore.getState().clearRanking();
  useJunoStore.setState({ snapshot: null, pending: false, stale: true });
}
function pauseForRateLimit(error: unknown, currentEpoch: number): boolean {
  if (!(error instanceof HttpError) || error.status !== 429 || epoch !== currentEpoch) return false;
  const seconds = error instanceof RateLimitError && Number.isFinite(error.retryAfter) ? error.retryAfter : 60;
  const delay = Math.max(1_000, Math.min(seconds * 1_000, 2_147_483_647));
  retryAt = Math.max(retryAt, Date.now() + delay);
  clearTimeout(recoveryTimer);
  useJunoStore.setState({ stale: true, error });
  recoveryTimer = setTimeout(() => {
    recoveryTimer = undefined;
    if (epoch !== currentEpoch) return;
    retryAt = 0;
    void useJunoStore.getState().load();
  }, retryAt - Date.now());
  return true;
}
const sameRankingTarget = (a: JunoRankingTarget | null, b: JunoRankingTarget) => !!a && a.accountId === b.accountId
  && a.origin === b.origin && a.spaceId === b.spaceId && a.selfId === b.selfId;
const sameTarget = (a: JunoTarget | null, b: JunoTarget | null) => a === b || !!a && !!b
  && a.accountId === b.accountId && a.origin === b.origin && a.channelId === b.channelId && a.selfId === b.selfId;
export const useJunoStore = create<JunoState>((set, get) => ({
  target: null, connected: false, hosts: {}, snapshot: null, observedAt: 0, loading: false, pending: false, stale: false, error: null, open: false,
  ranking: emptyRanking(), presentedViews: new Set(),
  presentView: target => {
    if (!sameTarget(target, get().target)) return () => {};
    const token = Symbol(); set(s => ({ presentedViews: new Set([...s.presentedViews, token]) }));
    return () => { if (get().presentedViews.has(token)) set(s => ({ presentedViews: new Set([...s.presentedViews].filter(view => view !== token)) })); };
  },
  clearRanking: () => { rankingRun++; set({ ranking: emptyRanking() }); },
  loadRanking: async (target, query = {}) => {
    const session = get().target;
    if (!session || session.accountId !== target.accountId || session.origin !== target.origin || session.selfId !== target.selfId) return;
    const run = ++rankingRun;
    if (Date.now() < retryAt) {
      set(s => ({ ranking: { ...emptyRanking(), target,
        page: sameRankingTarget(s.ranking.target, target) ? s.ranking.page : null,
        error: new RateLimitError(Math.ceil((retryAt - Date.now()) / 1_000)) } }));
      return;
    }
    const currentEpoch = epoch;
    set(s => ({ ranking: { ...emptyRanking(), target, loading: true,
      page: sameRankingTarget(s.ranking.target, target) ? s.ranking.page : null } }));
    try {
      const page = await getApiForOrigin(target.origin).juno.ranking(target.spaceId, query);
      if (run !== rankingRun || !sameRankingTarget(get().ranking.target, target)) return;
      set({ ranking: { target, page, loading: false, error: null, unsupported: false } });
    } catch (error) {
      if (run !== rankingRun || !sameRankingTarget(get().ranking.target, target)) return;
      pauseForRateLimit(error, currentEpoch);
      const status = error instanceof HttpError ? error.status : null;
      set(s => ({ ranking: { target, loading: false, page: status === 401 || status === 403 || status === 404 ? null : s.ranking.page,
        unsupported: status === 404, error: status === 404 ? null : error } }));
    }
  },
  setOpen: open => set({ open }),
  setHost: (origin, supported) => {
    set(s => ({ hosts: { ...s.hosts, [origin]: supported } }));
    if (get().target?.origin === origin) {
      get().clearRanking();
      epoch++; readRun++; cancelRecovery(); set({ snapshot: null, pending: false, stale: false, error: null, loading: false });
      if (supported) void get().load();
    }
  },
  bind: (target, connected) => {
    if (!sameTarget(target, get().target)) {
      get().clearRanking();
      epoch++; readRun++; cancelRecovery();
      set({ target, connected, snapshot: null, observedAt: 0, loading: false, pending: false, stale: false, error: null, open: false, presentedViews: new Set() });
    } else set({ connected });
  },
  load: async () => {
    const { target, connected } = get(); if (!target || !connected) return;
    if (Date.now() < retryAt) return;
    if (readFlight?.epoch === epoch) return readFlight.promise;
    const currentEpoch = epoch; const run = ++readRun;
    const snapshotAtStart = get().snapshot;
    const flight: ReadFlight = { epoch: currentEpoch, dirty: false, promise: Promise.resolve() };
    readFlight = flight;
    set({ loading: true });
    flight.promise = (async () => {
      try {
        const snapshot = await getApiForOrigin(target.origin).juno.get(target.channelId);
        if (epoch !== currentEpoch || run !== readRun) return;
        if (snapshot.revision >= (get().snapshot?.revision ?? -1)) set({ snapshot, observedAt: Date.now() });
        const coolingDown = Date.now() < retryAt;
        set({ loading: false, stale: coolingDown, ...(!get().pending && !coolingDown ? { error: null } : {}) });
      } catch (error) {
        if (epoch !== currentEpoch || run !== readRun) return;
        // Even a read predating a confirmed move can exhaust this IP's bucket.
        pauseForRateLimit(error, currentEpoch);
        // An older GET cannot erase a later confirmed command. Transient
        // failures retain that hand, but mutations wait for a fresh view.
        if (get().snapshot === snapshotAtStart) {
          if (inaccessible(error)) discardPrivateState();
          set({ loading: false, stale: true, error, ...(inaccessible(error) ? { snapshot: null } : {}) });
        } else set({ loading: false });
      } finally {
        if (readFlight === flight) {
          readFlight = null;
          if (flight.dirty && epoch === currentEpoch) void get().load();
        }
      }
    })();
    return flight.promise;
  },
  command: async action => {
    const { target, connected, pending, snapshot, stale } = get();
    if (!target || !connected || pending || stale || Date.now() < retryAt) return;
    if (action.type !== 'create' && !snapshot?.game) return;
    const command: JunoCommand = action.type === 'create' ? action
      : { ...action, gameId: snapshot!.game!.id, revision: snapshot!.revision };
    const currentEpoch = epoch;
    set({ pending: true, error: null });
    try {
      const next = await getApiForOrigin(target.origin).juno.command(target.channelId, command);
      if (epoch !== currentEpoch) return;
      if (next.revision >= (get().snapshot?.revision ?? -1)) set({ snapshot: next, observedAt: Date.now() });
    } catch (error) {
      if (epoch !== currentEpoch) return;
      set({ error });
      if (inaccessible(error)) { discardPrivateState(); return; }
      if (pauseForRateLimit(error, currentEpoch)) return;
      // Reconcile, never retry a mutation (even a draw or start).
      if (readFlight?.epoch === currentEpoch) readFlight.dirty = true;
      await get().load();
    } finally {
      if (epoch === currentEpoch) set({ pending: false });
    }
  },
  invalidate: (origin, channelId) => {
    const target = get().target;
    if (target?.origin !== origin || target.channelId !== channelId) return;
    if (readFlight?.epoch === epoch) readFlight.dirty = true;
    else void get().load();
  },
  reset: () => {
    get().clearRanking();
    epoch++; readRun++; cancelRecovery();
    set({ target: null, connected: false, hosts: {}, snapshot: null, loading: false, pending: false, stale: false, error: null, open: false, presentedViews: new Set() });
  },
}));
