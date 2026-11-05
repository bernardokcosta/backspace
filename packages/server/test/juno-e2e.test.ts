import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { canPlayJuno, type JunoAction, type JunoSnapshot } from '@backspace/shared/src/juno.js';
import { spawnInstance, type SpawnedInstance } from './helpers/twoInstanceHarness.js';
import { registerLocal, type TestUser } from './helpers/testUsers.js';
import { connectWs, type WsCapture } from './helpers/wsListener.js';
import { waitUntil } from './helpers/federationE2E.js';

vi.setConfig({ testTimeout: 60_000 });
let instance: SpawnedInstance;
let directory: string;
let channelId: string;
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
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'backspace-juno-e2e-'));
  const uploads = path.join(directory, 'uploads'); await mkdir(uploads);
  instance = await spawnInstance({ domain: 'juno.test.local', dbPath: path.join(directory, 'test.db'), storagePath: uploads,
    jwtSecret: randomBytes(32).toString('hex'), logPath: path.join(directory, 'server.log'), environment: { PASSWORD_HASH_COST: '4' } });
  for (const name of ['ada', 'bo', 'clem', 'dee', 'watcher']) users.push(await registerLocal(instance, name));
  const owner = users[0]!;
  const response = await call(owner, 'POST', '/api/spaces', { name: 'Juno acceptance' }); expect(response.status).toBe(201);
  const space = await response.json() as { id: string; inviteCode: string };
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
    let snapshot = views[0]!;
    for (let step = 0; step < 1_000 && snapshot.game!.phase === 'playing'; step++) {
      const user = users.find(u => u.id === snapshot.game!.currentPlayerId)!;
      const own = (await read(user)).game!;
      const playable = own.hand.find(card => (!own.drawnCardId || own.drawnCardId === card.id) && canPlayJuno(card, own.hand, own.topCard!, own.color!));
      snapshot = await act(user, playable ? { type: 'play', cardId: playable.id, color: 'mint', announce: true }
        : { type: own.drawnCardId ? 'pass' : 'draw' });
    }
    expect(snapshot.game!.phase).toBe('finished'); expect(snapshot.game!.winnerId).toBeTruthy();
    expect(sockets.every(ws => ws.events.some(e => e.type === 'juno_updated'))).toBe(true);
    for (const ws of sockets) for (const event of ws.events.filter(e => e.type === 'juno_updated')) expect(Object.keys(event).sort()).toEqual(['channelId', 'type']);
  });
});
