import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canPlayJuno, type JunoAction, type JunoSnapshot } from '@veyvox/shared/src/juno.js';
import { spawnInstance, stopInstance, type SpawnedInstance } from './helpers/instanceHarness.js';
import { registerLocal, type TestUser } from './helpers/testUsers.js';
import { connectWs, type WsCapture } from './helpers/wsListener.js';

let instance: SpawnedInstance, directory: string, channelId: string;
const users: TestUser[] = [], sockets: WsCapture[] = [];
const route = () => `/api/channels/${channelId}/juno?memory=1&intoxicated=1`;
async function call(user: TestUser, method: string, url: string, body?: unknown) {
  return fetch(instance.origin + url, { method, headers: { Authorization: `Bearer ${user.token}`,
    ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
}
async function read(user: TestUser): Promise<JunoSnapshot> {
  const response = await call(user, 'GET', route()); expect(response.status).toBe(200); return response.json() as Promise<JunoSnapshot>;
}
async function send(user: TestUser, view: JunoSnapshot, action: JunoAction | { type: 'create' }): Promise<JunoSnapshot> {
  const body = action.type === 'create' ? action : { ...action, gameId: view.game!.id, revision: view.revision };
  const response = await call(user, 'POST', route(), body); expect(response.status, await response.clone().text()).toBe(200);
  return response.json() as Promise<JunoSnapshot>;
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'veyvox-intoxicated-e2e-')); const uploads = path.join(directory, 'uploads'); await mkdir(uploads);
  instance = await spawnInstance({ domain: 'intoxicated.test.local', dbPath: path.join(directory, 'test.db'), storagePath: uploads,
    jwtSecret: randomBytes(32).toString('hex'), logPath: path.join(directory, 'server.log') });
  for (const name of ['ada', 'bo', 'clem', 'watcher']) users.push(await registerLocal(instance, name));
  const spaceResponse = await call(users[0]!, 'POST', '/api/spaces', { name: 'Entorpecido acceptance' }); expect(spaceResponse.status).toBe(201);
  const space = await spaceResponse.json() as { id: string; inviteCode: string };
  for (const user of users.slice(1)) expect((await call(user, 'POST', `/api/spaces/${space.id}/join`, { inviteCode: space.inviteCode })).status).toBe(200);
  const channel = await call(users[0]!, 'POST', `/api/spaces/${space.id}/channels`, { name: 'cards', type: 'voice' }); expect(channel.status).toBe(201);
  channelId = (await channel.json() as { id: string }).id;
  for (const user of users) {
    const ws = await connectWs(instance.origin, user.token); sockets.push(ws); await ws.waitForEvent('ready');
    ws.send({ type: 'voice_join', channelId }); expect(await ws.waitForEvent('voice_state_update')).toMatchObject({ userId: user.id, action: 'join' });
  }
}, 90_000);
afterAll(async () => {
  for (const socket of sockets) socket.close();
  if (instance?.proc.exitCode === null && instance.proc.signalCode === null) await stopInstance(instance);
  if (directory) await rm(directory, { recursive: true, force: true }); // Only this test's unique disposable instance.
});
describe('native Entorpecido HTTP and voice-socket boundary', () => {
  it('negotiates both cards, plays confirmed turns, redacts other hands and refuses stale/legacy mutations', async () => {
    let view = await send(users[0]!, await read(users[0]!), { type: 'create' });
    for (const user of users.slice(1, 3)) view = await send(user, view, { type: 'join' });
    view = await send(users[0]!, view, { type: 'start' });
    expect(view.supportsIntoxicated).toBe(true); expect(view.game).toMatchObject({ memoryEnabled: true, intoxicatedEnabled: true });
    const legacy = await call(users[3]!, 'GET', `/api/channels/${channelId}/juno?memory=1`);
    expect(legacy.status).toBe(409); expect(await legacy.json()).toMatchObject({ code: 'juno_update_required' });
    for (let step = 0; step < 24 && view.game!.phase === 'playing'; step++) {
      const player = users.find(user => user.id === view.game!.currentPlayerId)!;
      const own = await read(player), game = own.game!;
      const slot = game.memoryCurse?.targetUserId === player.id ? game.maskedHand?.[0] : undefined;
      const card = game.hand.find(c => (!game.drawnCardId || c.id === game.drawnCardId) && canPlayJuno(c, game.hand, game.topCard!, game.color!));
      const action: JunoAction = slot ? { type: 'play', cardId: slot.id, announce: true }
        : card ? { type: 'play', cardId: card.id, color: 'mint', announce: true } : { type: game.drawnCardId ? 'pass' : 'draw' };
      view = await send(player, own, action);
      const stale = await call(player, 'POST', route(), { ...action, gameId: game.id, revision: own.revision });
      expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ code: 'juno_stale' });
      const spectator = await read(users[3]!); expect(spectator.game!.hand).toEqual([]);
      expect(spectator.game!.lastMove?.misplayedCard).toBeUndefined();
      for (const hidden of view.game!.hand) expect(JSON.stringify(spectator)).not.toContain(hidden.id);
    }
    for (const socket of sockets) for (const event of socket.events.filter(e => e.type === 'juno_updated')) expect(Object.keys(event).sort()).toEqual(['channelId', 'type']);
  }, 60_000);
});
