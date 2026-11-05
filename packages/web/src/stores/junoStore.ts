import { create } from 'zustand';
import type { JunoAction, JunoCommand, JunoSnapshot, JunoRankingPage } from '@backspace/shared/src/juno';
import { getApiForOrigin } from '../utils/crossStoreResolvers';
import { HttpError } from '../api/client';

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
  error: unknown;
  open: boolean;
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
const sameRankingTarget = (a: JunoRankingTarget | null, b: JunoRankingTarget) => !!a && a.accountId === b.accountId
  && a.origin === b.origin && a.spaceId === b.spaceId && a.selfId === b.selfId;
const sameTarget = (a: JunoTarget | null, b: JunoTarget | null) => a === b || !!a && !!b
  && a.accountId === b.accountId && a.origin === b.origin && a.channelId === b.channelId && a.selfId === b.selfId;
export const useJunoStore = create<JunoState>((set, get) => ({
  target: null, connected: false, hosts: {}, snapshot: null, observedAt: 0, loading: false, pending: false, error: null, open: false,
  ranking: emptyRanking(),
  clearRanking: () => { rankingRun++; set({ ranking: emptyRanking() }); },
  loadRanking: async (target, query = {}) => {
    const session = get().target;
    if (!session || session.accountId !== target.accountId || session.origin !== target.origin || session.selfId !== target.selfId) return;
    const run = ++rankingRun;
    set(s => ({ ranking: { ...emptyRanking(), target, loading: true,
      page: sameRankingTarget(s.ranking.target, target) ? s.ranking.page : null } }));
    try {
      const page = await getApiForOrigin(target.origin).juno.ranking(target.spaceId, query);
      if (run !== rankingRun || !sameRankingTarget(get().ranking.target, target)) return;
      set({ ranking: { target, page, loading: false, error: null, unsupported: false } });
    } catch (error) {
      if (run !== rankingRun || !sameRankingTarget(get().ranking.target, target)) return;
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
      epoch++; readRun++; set({ snapshot: null, pending: false, error: null, loading: false });
      if (supported) void get().load();
    }
  },
  bind: (target, connected) => {
    if (!sameTarget(target, get().target)) {
      get().clearRanking();
      epoch++; readRun++;
      set({ target, connected, snapshot: null, observedAt: 0, loading: false, pending: false, error: null, open: false });
    } else set({ connected });
  },
  load: async () => {
    const { target, connected } = get(); if (!target || !connected) return;
    const currentEpoch = epoch; const run = ++readRun;
    const snapshotAtStart = get().snapshot;
    set({ loading: true, ...(!get().pending ? { error: null } : {}) });
    try {
      const snapshot = await getApiForOrigin(target.origin).juno.get(target.channelId);
      if (epoch !== currentEpoch || run !== readRun) return;
      if (snapshot.revision >= (get().snapshot?.revision ?? -1)) set({ snapshot, observedAt: Date.now() });
      set({ loading: false });
    } catch (error) {
      if (epoch !== currentEpoch || run !== readRun) return;
      // A command can confirm a newer view while this GET is in flight. Its
      // older failure is not evidence that the confirmed view lost access.
      if (get().snapshot === snapshotAtStart && error instanceof HttpError && (error.status === 401 || error.status === 403)) get().clearRanking();
      set({ loading: false, ...(get().snapshot === snapshotAtStart ? { snapshot: null, error } : {}) });
    }
  },
  command: async action => {
    const { target, connected, pending, snapshot } = get();
    if (!target || !connected || pending) return;
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
      // Reconcile, never retry a mutation (even a draw or start).
      await get().load();
    } finally {
      if (epoch === currentEpoch) set({ pending: false });
    }
  },
  invalidate: (origin, channelId) => {
    const target = get().target;
    if (target?.origin === origin && target.channelId === channelId) void get().load();
  },
  reset: () => {
    get().clearRanking();
    epoch++; readRun++;
    set({ target: null, connected: false, hosts: {}, snapshot: null, loading: false, pending: false, error: null, open: false });
  },
}));
