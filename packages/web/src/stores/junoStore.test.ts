import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JunoRankingPage, JunoSnapshot } from '@veyvox/shared/src/juno';
import { junoGame, junoRanking } from '../components/games/junoTestFixtures';
import { HttpError, RateLimitError } from '../api/client';
const api = vi.hoisted(() => ({ get: vi.fn(), command: vi.fn(), ranking: vi.fn() }));
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), api: { juno: api } }));
import { useJunoStore } from './junoStore';

const target = { origin: window.location.origin, channelId: 'voice', userId: 'host-row' };
const snapshot = (revision: number): JunoSnapshot => ({ revision, game: null });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
beforeEach(() => { vi.clearAllMocks(); api.get.mockReset(); api.command.mockReset(); api.ranking.mockReset(); useJunoStore.getState().reset(); useJunoStore.getState().bind(target, true); });
afterEach(() => { useJunoStore.getState().reset(); vi.useRealTimers(); });
describe('Juno session state', () => {
  it('has one capability flag and refuses a stale foreign-server binding instead of forwarding current credentials', async () => {
    expect(useJunoStore.getState()).not.toHaveProperty('hosts');
    useJunoStore.getState().bind({ ...target, origin: 'https://previous.invalid' }, true);
    await useJunoStore.getState().load(); await useJunoStore.getState().command({ type: 'create' });
    expect(api.get).not.toHaveBeenCalled(); expect(api.command).not.toHaveBeenCalled();
  });
  it('uses the current API and drops a late response after room/account changes', async () => {
    const response = deferred<JunoSnapshot>(); api.get.mockReturnValueOnce(response.promise);
    const load = useJunoStore.getState().load();
    useJunoStore.getState().bind({ ...target, channelId: 'another' }, true);
    response.resolve(snapshot(10)); await load;
    expect(api.get).toHaveBeenCalledWith('voice');
    expect(useJunoStore.getState().snapshot).toBeNull();
  });
  it('coalesces concurrent reads and ignores older revisions', async () => {
    const old = deferred<JunoSnapshot>(); api.get.mockReturnValueOnce(old.promise).mockResolvedValueOnce(snapshot(3));
    useJunoStore.setState({ snapshot: snapshot(3) });
    const first = useJunoStore.getState().load(); const duplicate = useJunoStore.getState().load();
    expect(api.get).toHaveBeenCalledTimes(1);
    old.resolve(snapshot(2)); await first;
    await duplicate;
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
    expect(api.command).toHaveBeenCalledTimes(1);
    expect(api.command).toHaveBeenCalledWith('voice', { type: 'report', targetUserId: 'host-opponent', opportunityId: 'miss-1', gameId: game.id, revision: 4 });
    expect(api.get).toHaveBeenCalledTimes(1); expect(useJunoStore.getState().snapshot?.revision).toBe(5);
    expect(useJunoStore.getState().snapshot?.game?.reportOpportunities).toEqual([]);
    expect(useJunoStore.getState().pending).toBe(false);
  });
  it.each([401, 403, 404])('clears private state when a current read is refused with %i', async status => {
    const denied = new HttpError(status, 'Access lost');
    useJunoStore.setState({ snapshot: snapshot(2) }); api.get.mockRejectedValueOnce(denied);
    await useJunoStore.getState().load();
    expect(useJunoStore.getState().snapshot).toBeNull(); expect(useJunoStore.getState().error).toBe(denied);
  });
});

describe('Juno transient recovery', () => {
  it('clears an incompatible view when an enhanced host requires a client update', async () => {
    useJunoStore.setState({ snapshot: { revision: 4, game: junoGame('playing') } });
    api.get.mockRejectedValueOnce(new HttpError(409, 'Update required', undefined, 'juno_update_required'));
    await useJunoStore.getState().load(); expect(useJunoStore.getState().snapshot).toBeNull();
  });
  it('cannot replace a newer masked view with an older unmasked response', async () => {
    const old = deferred<JunoSnapshot>(); api.get.mockReturnValueOnce(old.promise);
    const load = useJunoStore.getState().load();
    const masked: JunoSnapshot = { revision: 5, game: { ...junoGame('playing'), hand: [], color: null, topCard: null,
      memoryCurse: { id: 'curse', targetUserId: target.userId }, maskedHand: [{ id: 'secret-slot' }] } };
    useJunoStore.setState({ snapshot: masked }); old.resolve({ revision: 4, game: junoGame('playing') }); await load;
    expect(useJunoStore.getState().snapshot).toBe(masked);
  });
  it.each([new TypeError('Offline'), new HttpError(500, 'Temporary failure')])('retains the confirmed game on a transient read failure', async error => {
    const confirmed = { revision: 4, game: junoGame('playing') };
    useJunoStore.setState({ snapshot: confirmed, observedAt: 123 }); api.get.mockRejectedValueOnce(error);
    await useJunoStore.getState().load();
    expect(useJunoStore.getState().snapshot).toBe(confirmed);
    expect(useJunoStore.getState().observedAt).toBe(123);
    expect(useJunoStore.getState().stale).toBe(true);
    await useJunoStore.getState().command({ type: 'draw' });
    expect(api.command).not.toHaveBeenCalled();
    api.get.mockResolvedValueOnce({ ...confirmed, revision: 5 }); await useJunoStore.getState().load();
    expect(useJunoStore.getState().stale).toBe(false); expect(useJunoStore.getState().error).toBeNull();
  });
  it('pauses polling, invalidations, manual retry, ranking and commands until Retry-After', async () => {
    vi.useFakeTimers();
    const confirmed = { revision: 4, game: junoGame('playing') };
    useJunoStore.setState({ snapshot: confirmed });
    api.get.mockRejectedValueOnce(new RateLimitError(10)).mockResolvedValueOnce({ ...confirmed, revision: 5 });
    await useJunoStore.getState().load();
    for (let i = 0; i < 20; i++) {
      useJunoStore.getState().invalidate(target.channelId);
      await useJunoStore.getState().load();
    }
    await useJunoStore.getState().command({ type: 'draw' });
    await useJunoStore.getState().loadRanking({ ...target, spaceId: 'space' });
    expect(api.get).toHaveBeenCalledTimes(1); expect(api.command).not.toHaveBeenCalled(); expect(api.ranking).not.toHaveBeenCalled();
    expect(useJunoStore.getState().snapshot).toBe(confirmed);
    await vi.advanceTimersByTimeAsync(9_999); expect(api.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(api.get).toHaveBeenCalledTimes(2);
    expect(useJunoStore.getState().snapshot?.revision).toBe(5); expect(useJunoStore.getState().stale).toBe(false);
  });
  it('does not replay a rate-limited action or immediately reconcile against the exhausted bucket', async () => {
    vi.useFakeTimers(); useJunoStore.setState({ snapshot: { revision: 4, game: junoGame('playing') } });
    api.command.mockRejectedValueOnce(new RateLimitError(3)); api.get.mockResolvedValueOnce(snapshot(5));
    await useJunoStore.getState().command({ type: 'draw' });
    expect(api.command).toHaveBeenCalledTimes(1); expect(api.get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(api.get).toHaveBeenCalledTimes(1); expect(api.command).toHaveBeenCalledTimes(1);
  });
  it('does not clear a newer command cooldown when an older GET succeeds', async () => {
    vi.useFakeTimers(); const response = deferred<JunoSnapshot>();
    useJunoStore.setState({ snapshot: { revision: 4, game: junoGame('playing') } });
    api.get.mockReturnValueOnce(response.promise); const load = useJunoStore.getState().load();
    const limited = new RateLimitError(10); api.command.mockRejectedValueOnce(limited);
    await useJunoStore.getState().command({ type: 'draw' });
    response.resolve({ revision: 4, game: junoGame('playing') }); await load;
    expect(useJunoStore.getState().stale).toBe(true); expect(useJunoStore.getState().error).toBe(limited);
    await useJunoStore.getState().command({ type: 'draw' }); expect(api.command).toHaveBeenCalledTimes(1);
  });
  it('honors an older GET rate limit without erasing a newer confirmed command', async () => {
    vi.useFakeTimers(); const response = deferred<JunoSnapshot>();
    useJunoStore.setState({ snapshot: { revision: 4, game: junoGame('playing') } });
    api.get.mockReturnValueOnce(response.promise); const load = useJunoStore.getState().load();
    const confirmed = { revision: 5, game: junoGame('playing') };
    api.command.mockResolvedValueOnce(confirmed); await useJunoStore.getState().command({ type: 'draw' });
    const limited = new RateLimitError(60); response.reject(limited); await load;
    expect(useJunoStore.getState().snapshot).toBe(confirmed); expect(useJunoStore.getState().stale).toBe(true);
    expect(useJunoStore.getState().error).toBe(limited);
    await useJunoStore.getState().load(); await useJunoStore.getState().command({ type: 'pass' });
    expect(api.get).toHaveBeenCalledTimes(1); expect(api.command).toHaveBeenCalledTimes(1);
  });
  it('collapses a burst during an active read into exactly one trailing refresh', async () => {
    const first = deferred<JunoSnapshot>(); const next = deferred<JunoSnapshot>();
    api.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
    const load = useJunoStore.getState().load();
    for (let i = 0; i < 30; i++) useJunoStore.getState().invalidate(target.channelId);
    expect(api.get).toHaveBeenCalledTimes(1);
    first.resolve(snapshot(4)); await load; await Promise.resolve();
    expect(api.get).toHaveBeenCalledTimes(2);
    next.resolve(snapshot(5)); await Promise.resolve(); await Promise.resolve();
    expect(useJunoStore.getState().snapshot?.revision).toBe(5);
  });
  it('does not let an old room flight block or overwrite the new room', async () => {
    const old = deferred<JunoSnapshot>(); api.get.mockReturnValueOnce(old.promise).mockResolvedValueOnce(snapshot(2));
    const first = useJunoStore.getState().load(); useJunoStore.getState().invalidate(target.channelId);
    useJunoStore.getState().bind({ ...target, channelId: 'new-room' }, true);
    await useJunoStore.getState().load(); old.resolve(snapshot(99)); await first;
    expect(api.get).toHaveBeenCalledTimes(2); expect(useJunoStore.getState().snapshot?.revision).toBe(2);
  });
  it('does not let an older command restore private state after a current access refusal', async () => {
    useJunoStore.setState({ snapshot: { revision: 4, game: junoGame('playing') } });
    const response = deferred<JunoSnapshot>(); api.command.mockReturnValueOnce(response.promise);
    const command = useJunoStore.getState().command({ type: 'draw' });
    api.get.mockRejectedValueOnce(new HttpError(403, 'Access lost')); await useJunoStore.getState().load();
    response.resolve({ revision: 5, game: junoGame('playing') }); await command;
    expect(useJunoStore.getState().snapshot).toBeNull(); expect(useJunoStore.getState().pending).toBe(false);
  });
  it('shares a ranking rate-limit cooldown with table reads and recovers after its deadline', async () => {
    vi.useFakeTimers(); useJunoStore.setState({ snapshot: { revision: 4, game: junoGame('playing') } });
    const limited = new RateLimitError(2); api.ranking.mockRejectedValueOnce(limited);
    await useJunoStore.getState().loadRanking({ ...target, spaceId: 'space' });
    await useJunoStore.getState().load(); expect(api.get).not.toHaveBeenCalled();
    expect(useJunoStore.getState().error).toBe(limited);
    api.get.mockResolvedValueOnce(snapshot(5)); await vi.advanceTimersByTimeAsync(2_000);
    expect(useJunoStore.getState().snapshot?.revision).toBe(5);
  });
  it.each(['reset', 'switch', 'reconnect'])('cancels a previous cooldown on %s', async mode => {
    vi.useFakeTimers(); api.get.mockRejectedValueOnce(new RateLimitError(10)); await useJunoStore.getState().load();
    if (mode === 'reset') useJunoStore.getState().reset();
    else if (mode === 'switch') useJunoStore.getState().bind({ ...target, userId: 'new-account' }, true);
    else useJunoStore.getState().setSupported(false);
    await vi.advanceTimersByTimeAsync(10_000); expect(api.get).toHaveBeenCalledTimes(1);
    expect(useJunoStore.getState().snapshot).toBeNull();
  });
});

describe('Juno ranking scoped reads', () => {
  const rankingTarget = { origin: target.origin, spaceId: 'space', userId: target.userId };
  it('uses the host and ignores an old space response', async () => {
    const old = deferred<JunoRankingPage>(); api.ranking.mockReturnValueOnce(old.promise).mockResolvedValueOnce(junoRanking('other'));
    const first = useJunoStore.getState().loadRanking(rankingTarget);
    await useJunoStore.getState().loadRanking({ ...rankingTarget, spaceId: 'other' });
    old.resolve(junoRanking()); await first;
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
