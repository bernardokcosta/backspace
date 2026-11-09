import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { canPlayJuno, type JunoAction, type JunoSnapshot, type JunoRankingPage } from '@veyvox/shared/src/juno.js';
import { spawnInstance, type SpawnedInstance } from './helpers/twoInstanceHarness.js';
import { registerLocal, type TestUser } from './helpers/testUsers.js';
import { connectWs, type WsCapture } from './helpers/wsListener.js';
import { waitUntil } from './helpers/federationE2E.js';

vi.setConfig({ testTimeout: 60_000 });
let instance: SpawnedInstance;
let directory: string;
let channelId: string;
let spaceId: string;
const users: TestUser[] = [];
const sockets: WsCapture[] = [];
async function call(user: TestUser, method: string, url: string, body?: unknown): Promise<Response> {
  return fetch(`${instance.origin}${url}`, { method, headers: { Authorization: `Bearer ${user.token}`,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function read(user: TestUser): Promise<JunoSnapshot> {
  const res = await call(user, 'GET', `/api/channels/${channelId}/juno`); expect(res.status).toBe(200); return res.json() as Promise<JunoSnapshot>;
}
async function act(user: TestUser, action: JunoAction | { type: 'create' }): Promise<JunoSnapshot> {
  const previous = await read(user);
  const body = action.type === 'create' ? action : { ...action, gameId: previous.game!.id, revision: previous.revision };
  const res = await call(user, 'POST', `/api/channels/${channelId}/juno`, body);
  expect(res.status, await res.clone().text()).toBe(200); return res.json() as Promise<JunoSnapshot>;
}
async function finishRound(snapshot: JunoSnapshot, testReport = false): Promise<JunoSnapshot> {
  let reported = false;
  for (let step = 0; step < 1_000 && snapshot.game!.phase === 'playing'; step++) {
    const user = users.find(u => u.id === snapshot.game!.currentPlayerId)!;
    const own = (await read(user)).game!;
    const playable = own.hand.find(card => (!own.drawnCardId || own.drawnCardId === card.id) && canPlayJuno(card, own.hand, own.topCard!, own.color!));
    const miss = testReport && !reported && own.hand.length === 2 && !!playable;
    snapshot = await act(user, playable ? { type: 'play', cardId: playable.id, color: 'mint', announce: !miss }
      : { type: own.drawnCardId ? 'pass' : 'draw' });
    if (miss) {
      const opportunity = snapshot.game!.reportOpportunities!.find(w => w.targetUserId === user.id)!;
      expect(opportunity).toBeTruthy(); expect(snapshot.game!.hand).toHaveLength(1);
      const reporter = users.find(u => u.id !== user.id && u.id !== snapshot.game!.currentPlayerId && snapshot.game!.players.some(p => p.userId === u.id))!;
      const before = (await read(reporter)).game!;
      const action: JunoAction = { type: 'report', targetUserId: user.id, opportunityId: opportunity.id };
      const spectator = await read(users[4]!);
      expect((await call(users[4]!, 'POST', `/api/channels/${channelId}/juno`, { ...action, gameId: spectator.game!.id, revision: spectator.revision })).status).toBe(400);
      snapshot = await act(reporter, action);
      expect((await read(user)).game!.hand).toHaveLength(3);
      expect(snapshot.game!.lastMove).toMatchObject({ type: 'report', userId: reporter.id, targetUserId: user.id, amount: 2 });
      expect(snapshot.game!.currentPlayerId).toBe(before.currentPlayerId);
      expect(snapshot.game!.remainingMs).toBeLessThanOrEqual(before.remainingMs);
      const privateCards = (await read(user)).game!.hand;
      for (const card of privateCards) expect(JSON.stringify(snapshot)).not.toContain(card.id);
      expect((await call(reporter, 'POST', `/api/channels/${channelId}/juno`, { ...action, gameId: snapshot.game!.id, revision: snapshot.revision })).status).toBe(400);
      reported = true;
    }
  }
  if (testReport) expect(reported).toBe(true);
  return snapshot;
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'backspace-juno-e2e-'));
  const uploads = path.join(directory, 'uploads'); await mkdir(uploads);
  instance = await spawnInstance({ domain: 'juno.test.local', dbPath: path.join(directory, 'test.db'), storagePath: uploads,
    jwtSecret: randomBytes(32).toString('hex'), logPath: path.join(directory, 'server.log'), environment: { PASSWORD_HASH_COST: '4' } });
  for (const name of ['ada', 'bo', 'clem', 'dee', 'watcher']) users.push(await registerLocal(instance, name));
  const owner = users[0]!;
  const response = await call(owner, 'POST', '/api/spaces', { name: 'Juno acceptance' }); expect(response.status).toBe(201);
  const space = await response.json() as { id: string; inviteCode: string };
  spaceId = space.id;
  for (const user of users.slice(1)) expect((await call(user, 'POST', `/api/spaces/${space.id}/join`, { inviteCode: space.inviteCode })).status).toBe(200);
  const channel = await call(owner, 'POST', `/api/spaces/${space.id}/channels`, { name: 'juno-table', type: 'voice' });
  expect(channel.status).toBe(201); channelId = ((await channel.json()) as { id: string }).id;
  for (const user of users) {
    const ws = await connectWs(instance.origin, user.token); sockets.push(ws);
    expect((await ws.waitForEvent('ready')).supportsJuno).toBe(true);
    ws.send({ type: 'voice_join', channelId });
    await waitUntil(() => ws.events.some(e => e.type === 'voice_state_update' && e.userId === user.id && e.action === 'join'), { timeoutMs: 5_000 });
  }
}, 90_000);
afterAll(async () => {
  for (const ws of sockets) ws.close();
  if (instance?.proc.exitCode === null && instance.proc.signalCode === null) {
    const exited = new Promise<void>(resolve => instance.proc.once('exit', () => resolve())); instance.proc.kill('SIGTERM'); await exited;
  }
  if (directory) await rm(directory, { recursive: true, force: true }); // Only this suite's unique fixture.
});
describe('real Juno server with four independently authenticated voice sockets', () => {
  it('plays a complete four-player round, keeps private hands secret and supports a spectator', async () => {
    await act(users[0]!, { type: 'create' });
    for (const user of users.slice(1, 4)) await act(user, { type: 'join' });
    await act(users[0]!, { type: 'start' });
    const views = await Promise.all(users.map(read));
    expect(views[4]!.game!.hand).toEqual([]);
    for (let i = 0; i < 4; i++) {
      expect(views[i]!.game!.hand).toHaveLength(7);
      for (let j = 0; j < 5; j++) if (i !== j) for (const card of views[i]!.game!.hand) expect(JSON.stringify(views[j])).not.toContain(card.id);
    }
    const snapshot = await finishRound(views[0]!, true);
    expect(snapshot.game!.phase).toBe('finished'); expect(snapshot.game!.winnerId).toBeTruthy();
    expect(sockets.every(ws => ws.events.some(e => e.type === 'juno_updated'))).toBe(true);
    for (const ws of sockets) for (const event of ws.events.filter(e => e.type === 'juno_updated')) expect(Object.keys(event).sort()).toEqual(['channelId', 'type']);
    expect(snapshot.game!.scoreboard?.status).toBe('credited');
    const board = snapshot.game!.scoreboard!;
    const ranking = await (await call(users[4]!, 'GET', `/api/spaces/${spaceId}/juno/ranking`)).json() as JunoRankingPage;
    expect(ranking.entries).toHaveLength(4); expect(ranking.me.totalXp).toBe(0);
    for (const row of board.standings) expect(ranking.entries.find(r => r.user.id === row.userId)?.totalXp).toBe(row.xp);
    for (let i = 0; i < 10; i++) expect((await read(users[0]!)).game!.scoreboard).toEqual(board);
  });
  it('adds a private-hand computer through HTTP, observes a paced server move and leaves rankings unchanged', async () => {
    const owner = users[0]!;
    const rankingUrl = `/api/spaces/${spaceId}/juno/ranking`;
    const before = await (await call(owner, 'GET', rankingUrl)).json() as JunoRankingPage;
    await act(owner, { type: 'rematch' });
    const lobby = await act(owner, { type: 'addBot' });
    const bot = lobby.game!.players.find(p => p.computer)!;
    expect(bot.name).not.toBe('Deleted User'); expect(bot.user).toBeUndefined();
    const snapshot = await act(owner, { type: 'start' });
    expect(snapshot.game!.practice).toBe(true); expect(snapshot.game!.hand).toHaveLength(7);
    let own = snapshot;
    for (let n = 0; n < 2 && own.game!.currentPlayerId === owner.id; n++) own = await act(owner, { type: own.game!.drawnCardId ? 'pass' : 'draw' });
    await waitUntil(async () => (await read(owner)).game!.lastMove?.userId === bot.userId, { timeoutMs: 6000 });
    const move = (await read(owner)).game!.lastMove!;
    expect(move.id).toBeTruthy(); expect((await read(owner)).game!.lastMove!.id).toBe(move.id);
    expect((await read(users[4]!)).game!.hand).toEqual([]);
    await act(owner, { type: 'leave' });
    expect((await read(owner)).game).toBeNull();
    const after = await (await call(owner, 'GET', rankingUrl)).json() as JunoRankingPage;
    expect(after.entries.map(r => [r.user.id, r.totalXp, r.wins, r.completedRounds])).toEqual(before.entries.map(r => [r.user.id, r.totalXp, r.wins, r.completedRounds]));
  });
  it('combines another channel, survives host restart and isolates another space', async () => {
    const channel = await call(users[0]!, 'POST', `/api/spaces/${spaceId}/channels`, { name: 'second-table', type: 'voice' });
    channelId = ((await channel.json()) as { id: string }).id;
    for (let i = 0; i < 2; i++) {
      sockets[i]!.send({ type: 'voice_join', channelId });
      await waitUntil(() => sockets[i]!.events.some(e => e.type === 'voice_state_update' && e.channelId === channelId && e.userId === users[i]!.id && e.action === 'join'), { timeoutMs: 5000 });
    }
    await act(users[0]!, { type: 'create' }); await act(users[1]!, { type: 'join' });
    expect((await finishRound(await act(users[0]!, { type: 'start' }))).game!.scoreboard?.status).toBe('credited');
    const before = await (await call(users[0]!, 'GET', `/api/spaces/${spaceId}/juno/ranking`)).json() as JunoRankingPage;
    expect(before.me.completedRounds).toBe(2);
    for (const ws of sockets) ws.close();
    const exited = new Promise<void>(resolve => instance.proc.once('exit', () => resolve())); instance.proc.kill('SIGTERM'); await exited;
    instance = await spawnInstance({ domain: instance.domain, dbPath: instance.dbPath, storagePath: instance.storagePath,
      jwtSecret: instance.jwtSecret, logPath: path.join(directory, 'restarted.log') });
    const after = await (await call(users[0]!, 'GET', `/api/spaces/${spaceId}/juno/ranking`)).json() as JunoRankingPage;
    expect(after.me).toMatchObject({ totalXp: before.me.totalXp, wins: before.me.wins,
      completedRounds: before.me.completedRounds, rank: before.me.rank, user: { id: before.me.user.id } });
    const another = await (await call(users[0]!, 'POST', '/api/spaces', { name: 'Independent XP' })).json() as { id: string };
    const empty = await (await call(users[0]!, 'GET', `/api/spaces/${another.id}/juno/ranking`)).json() as JunoRankingPage;
    expect(empty.total).toBe(0); expect(empty.me.totalXp).toBe(0);
  });
});
