import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JunoRankingPage, JunoSnapshot } from '@backspace/shared/src/juno';
import { junoGame, junoRanking } from '../components/games/junoTestFixtures';
import { HttpError } from '../api/client';
const api = vi.hoisted(() => ({ get: vi.fn(), command: vi.fn(), ranking: vi.fn() }));
const resolve = vi.hoisted(() => vi.fn(() => ({ juno: api })));
vi.mock('../utils/crossStoreResolvers', () => ({ getApiForOrigin: resolve }));
import { useJunoStore } from './junoStore';

const target = { accountId: 'home-id', origin: 'https://remote.test', channelId: 'voice', selfId: 'host-row' };
const snapshot = (revision: number): JunoSnapshot => ({ revision, game: null });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
beforeEach(() => { vi.clearAllMocks(); useJunoStore.getState().reset(); useJunoStore.getState().bind(target, true); });
describe('Juno session state', () => {
  it('routes to the channel origin and drops a late response after room/account changes', async () => {
    const response = deferred<JunoSnapshot>(); api.get.mockReturnValueOnce(response.promise);
    const load = useJunoStore.getState().load();
    useJunoStore.getState().bind({ ...target, channelId: 'another' }, true);
    response.resolve(snapshot(10)); await load;
    expect(resolve).toHaveBeenCalledWith(target.origin); expect(api.get).toHaveBeenCalledWith('voice');
    expect(useJunoStore.getState().snapshot).toBeNull();
  });
  it('invalidates earlier fetches and ignores older revisions', async () => {
    const old = deferred<JunoSnapshot>(); api.get.mockReturnValueOnce(old.promise).mockResolvedValueOnce(snapshot(3));
    const first = useJunoStore.getState().load(); await useJunoStore.getState().load();
    old.resolve(snapshot(2)); await first;
    expect(useJunoStore.getState().snapshot?.revision).toBe(3);
  });
  it('never replays actions, blocks concurrent submission, and clears on reset', async () => {
    const reply = deferred<JunoSnapshot>(); api.command.mockReturnValue(reply.promise);
    const one = useJunoStore.getState().command({ type: 'create' });
    await useJunoStore.getState().command({ type: 'create' });
    expect(api.command).toHaveBeenCalledTimes(1);
    useJunoStore.getState().reset(); reply.resolve(snapshot(4)); await one;
    expect(useJunoStore.getState().snapshot).toBeNull(); expect(useJunoStore.getState().pending).toBe(false);
  });
  it('does not let an older failed GET erase a later confirmed command', async () => {
    const old = deferred<JunoSnapshot>(); api.get.mockReturnValueOnce(old.promise);
    useJunoStore.setState({ snapshot: snapshot(1) });
    const load = useJunoStore.getState().load();
    api.command.mockResolvedValueOnce(snapshot(2));
    await useJunoStore.getState().command({ type: 'create' });
    expect(useJunoStore.getState().snapshot?.revision).toBe(2);
    old.reject(new Error('Old request failed')); await load;
    expect(useJunoStore.getState().snapshot?.revision).toBe(2);
    expect(useJunoStore.getState().error).toBeNull();
    expect(useJunoStore.getState().loading).toBe(false);
    expect(api.command).toHaveBeenCalledTimes(1);
  });
  it('does not act while the voice connection is reconnecting', async () => {
    useJunoStore.getState().bind(target, false); await useJunoStore.getState().command({ type: 'create' });
    expect(api.command).not.toHaveBeenCalled();
  });
  it('routes a stale report to its origin once and reconciles without replaying the accusation', async () => {
    const game = junoGame('playing'); game.supportsReports = true;
    game.reportOpportunities = [{ id: 'miss-1', targetUserId: 'host-opponent', remainingMs: 1000 }];
    useJunoStore.setState({ snapshot: { revision: 4, game } });
    api.command.mockRejectedValueOnce(new HttpError(409, 'stale'));
    api.get.mockResolvedValueOnce({ revision: 5, game: { ...game, reportOpportunities: [] } });
    await useJunoStore.getState().command({ type: 'report', targetUserId: 'host-opponent', opportunityId: 'miss-1' });
    expect(resolve).toHaveBeenCalledWith(target.origin);
    expect(api.command).toHaveBeenCalledTimes(1);
    expect(api.command).toHaveBeenCalledWith('voice', { type: 'report', targetUserId: 'host-opponent', opportunityId: 'miss-1', gameId: game.id, revision: 4 });
    expect(api.get).toHaveBeenCalledTimes(1); expect(useJunoStore.getState().snapshot?.revision).toBe(5);
    expect(useJunoStore.getState().snapshot?.game?.reportOpportunities).toEqual([]);
    expect(useJunoStore.getState().pending).toBe(false);
  });
  it('still clears a confirmed view when a subsequent current read is refused', async () => {
    const denied = new Error('Permission revoked');
    useJunoStore.setState({ snapshot: snapshot(2) }); api.get.mockRejectedValueOnce(denied);
    await useJunoStore.getState().load();
    expect(useJunoStore.getState().snapshot).toBeNull(); expect(useJunoStore.getState().error).toBe(denied);
  });
});

describe('Juno ranking scoped reads', () => {
  const rankingTarget = { accountId: target.accountId, origin: target.origin, spaceId: 'space', selfId: target.selfId };
  it('uses the host and ignores an old space response', async () => {
    const old = deferred<JunoRankingPage>(); api.ranking.mockReturnValueOnce(old.promise).mockResolvedValueOnce(junoRanking('other'));
    const first = useJunoStore.getState().loadRanking(rankingTarget);
    await useJunoStore.getState().loadRanking({ ...rankingTarget, spaceId: 'other' });
    old.resolve(junoRanking()); await first;
    expect(resolve).toHaveBeenCalledWith(target.origin);
    expect(useJunoStore.getState().ranking.page?.spaceId).toBe('other');
  });
  it('drops older page failures after a newer success and clears data on permission loss', async () => {
    const old = deferred<JunoRankingPage>(); api.ranking.mockReturnValueOnce(old.promise).mockResolvedValueOnce(junoRanking());
    const first = useJunoStore.getState().loadRanking(rankingTarget);
    await useJunoStore.getState().loadRanking(rankingTarget, { offset: 25 });
    old.reject(new Error('old')); await first; expect(useJunoStore.getState().ranking.error).toBeNull();
    api.ranking.mockRejectedValueOnce(new HttpError(403, 'denied'));
    await useJunoStore.getState().loadRanking(rankingTarget); expect(useJunoStore.getState().ranking.page).toBeNull();
  });
  it('never installs a late response after logout or a different origin/account', async () => {
    const response = deferred<JunoRankingPage>(); api.ranking.mockReturnValueOnce(response.promise);
    const load = useJunoStore.getState().loadRanking(rankingTarget); useJunoStore.getState().reset();
    response.resolve(junoRanking()); await load; expect(useJunoStore.getState().ranking.page).toBeNull();
  });
  it('distinguishes old-host unavailability from a successful empty ranking', async () => {
    api.ranking.mockRejectedValueOnce(new HttpError(404, 'unknown route'));
    await useJunoStore.getState().loadRanking(rankingTarget); expect(useJunoStore.getState().ranking.unsupported).toBe(true);
    expect(useJunoStore.getState().ranking.page).toBeNull();
  });
});
