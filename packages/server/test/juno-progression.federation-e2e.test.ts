import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { canPlayJuno, type JunoCommand, type JunoRankingPage, type JunoSnapshot } from '@veyvox/shared/src/juno.js';
import { bootTwoInstances, type TwoInstanceHarness } from './helpers/twoInstanceHarness.js';
import { createFederatedUser, registerLocal, type TestUser } from './helpers/testUsers.js';
import { connectWs, type WsCapture } from './helpers/wsListener.js';
import { waitUntil } from './helpers/federationE2E.js';
vi.setConfig({ testTimeout: 90000 });
let harness: TwoInstanceHarness;
const sockets: WsCapture[] = [];
beforeAll(async () => { harness = await bootTwoInstances(); }, 120000);
afterAll(async () => { for (const ws of sockets) ws.close(); await harness?.cleanup(); });
async function call(user: TestUser, method: string, route: string, body?: unknown): Promise<Response> {
  return fetch(`${user.origin}${route}`, { method, headers: { Authorization: `Bearer ${user.token}`,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
describe('Juno XP on a client-federated space host', () => {
  it('credits the host-issued identity, not the home id or a foreign token', async () => {
    const { homeUser, remoteUser } = await createFederatedUser(harness.home, harness.remote, 'juno');
    const owner = await registerLocal(harness.remote, 'host');
    const space = await (await call(owner, 'POST', '/api/spaces', { name: 'Remote Juno' })).json() as { id: string; inviteCode: string };
    expect((await call(remoteUser, 'POST', `/api/spaces/${space.id}/join`, { inviteCode: space.inviteCode })).status).toBe(200);
    const channel = await (await call(owner, 'POST', `/api/spaces/${space.id}/channels`, { name: 'cards', type: 'voice' })).json() as { id: string };
    for (const user of [owner, remoteUser]) {
      const ws = await connectWs(harness.remote.origin, user.token); sockets.push(ws); await ws.waitForEvent('ready');
      ws.send({ type: 'voice_join', channelId: channel.id });
      await waitUntil(() => ws.events.some(e => e.type === 'voice_state_update' && e.userId === user.id && e.action === 'join'), { timeoutMs: 5000 });
    }
    const route = `/api/channels/${channel.id}/juno`;
    const read = async (user: TestUser) => (await (await call(user, 'GET', route)).json()) as JunoSnapshot;
    const send = async (user: TestUser, command: JunoCommand) => {
      const response = await call(user, 'POST', route, command); expect(response.status).toBe(200); return response.json() as Promise<JunoSnapshot>;
    };
    let view = await send(owner, { type: 'create' });
    view = await send(remoteUser, { type: 'join', gameId: view.game!.id, revision: view.revision });
    view = await send(owner, { type: 'start', gameId: view.game!.id, revision: view.revision });
    for (let step = 0; step < 1000 && view.game!.phase === 'playing'; step++) {
      const actor = view.game!.currentPlayerId === owner.id ? owner : remoteUser;
      view = await read(actor); const game = view.game!;
      const card = game.hand.find(c => (!game.drawnCardId || c.id === game.drawnCardId) && canPlayJuno(c, game.hand, game.topCard!, game.color!));
      view = await send(actor, { gameId: game.id, revision: view.revision,
        ...(card ? { type: 'play', cardId: card.id, color: 'mint', announce: true } : { type: game.drawnCardId ? 'pass' : 'draw' }) });
    }
    expect(view.game!.scoreboard?.status).toBe('credited');
    const rankingRoute = `/api/spaces/${space.id}/juno/ranking`;
    const ranking = await (await call(remoteUser, 'GET', rankingRoute)).json() as JunoRankingPage;
    expect(ranking.me.user.id).toBe(remoteUser.id); expect(ranking.me.completedRounds).toBe(1);
    expect(ranking.entries.map(r => r.user.id)).not.toContain(homeUser.id);
    expect((await fetch(`${harness.remote.origin}${rankingRoute}`, { headers: { Authorization: `Bearer ${homeUser.token}` } })).status).toBe(401);
    const homeSpace = await (await call(homeUser, 'POST', '/api/spaces', { name: 'Home ranking' })).json() as { id: string };
    const homeRanking = await (await call(homeUser, 'GET', `/api/spaces/${homeSpace.id}/juno/ranking`)).json() as JunoRankingPage;
    expect(homeRanking.total).toBe(0); expect(homeRanking.me.totalXp).toBe(0);
  });
});
