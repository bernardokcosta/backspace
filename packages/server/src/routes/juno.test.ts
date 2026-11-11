import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { JunoSnapshot } from '@veyvox/shared/src/juno.js';

const state = vi.hoisted(() => ({ member: true, permission: true, room: 'voice', socket: 1, bot: false, changed: vi.fn() }));
vi.mock('../db/index.js', () => ({ schema: { channels: { id: 'id' }, users: { id: 'id' } }, getDb: () => ({
  select: () => ({ from: (table: unknown) => ({ where: () => ({ get: () => table === schema.channels
    ? { id: 'voice', type: 'voice', spaceId: 'space' } : { id: 'remote-row', username: 'Alice', isBot: state.bot ? 1 : 0 } }) }) }),
}) }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));
vi.mock('../utils/auth.js', () => ({ authenticate: async (request: { userId: string; headers: Record<string, string> }, reply: { code: (code: number) => { send: () => void } }) => {
  if (!request.headers.authorization) return reply.code(401).send();
  request.userId = request.headers.authorization;
} }));
vi.mock('../utils/permissions.js', () => ({ isMember: () => state.member, hasPermission: () => state.permission }));
vi.mock('../ws/handler.js', () => ({ connectionManager: {
  getUserRoom: () => ({ roomId: state.room }), getVoiceWs: () => ({ readyState: state.socket }), sendToChannel: state.changed,
} }));
import { schema } from '../db/index.js';
vi.mock('../games/junoProgression.js', () => ({ settleJunoRound: vi.fn(), readJunoRanking: vi.fn(), hydrateJunoSnapshot: (snapshot: JunoSnapshot) => snapshot }));
import { junoRoutes } from './juno.js';
import { JunoRooms } from '../games/juno.js';
let app: FastifyInstance;
const url = '/api/channels/voice/juno';
const headers = { authorization: 'remote-row' };
beforeEach(async () => {
  Object.assign(state, { member: true, permission: true, room: 'voice', socket: 1, bot: false });
  state.changed.mockClear(); app = Fastify(); await app.register(junoRoutes);
});
afterEach(async () => { await app.close(); });
const create = () => app.inject({ method: 'POST', url, headers, payload: { type: 'create' } });
describe('Juno authorized transport', () => {
  it('enables the enhanced deck, refuses unsupported views without leaking data and still allows leave', async () => {
    let view = (await app.inject({ method: 'POST', url: url + '?memory=1', headers, payload: { type: 'create' } })).json<JunoSnapshot>();
    const send = async (type: 'join' | 'start' | 'leave', who: string, memory = true) => app.inject({ method: 'POST', url: url + (memory ? '?memory=1' : ''),
      headers: { authorization: who }, payload: { type, gameId: view.game!.id, revision: view.revision } });
    view = (await send('join', 'guest')).json<JunoSnapshot>(); view = (await send('start', 'remote-row')).json<JunoSnapshot>();
    expect(view.game?.memoryEnabled).toBe(true);
    const old = await app.inject({ method: 'GET', url, headers });
    expect(old.statusCode).toBe(409); expect(old.json().code).toBe('juno_update_required');
    expect(old.json().game).toBeUndefined(); expect(old.json().hand).toBeUndefined();
    state.permission = false;
    expect((await app.inject({ method: 'GET', url, headers })).statusCode).toBe(403); state.permission = true;
    const left = await send('leave', 'guest', false); expect(left.statusCode).toBe(200); expect(left.json().game).toBeNull();
  });
  it('keeps a mixed cohort classic and validates capability queries', async () => {
    let view = (await app.inject({ method: 'POST', url: url + '?memory=1', headers, payload: { type: 'create' } })).json<JunoSnapshot>();
    view = (await app.inject({ method: 'POST', url, headers: { authorization: 'legacy' }, payload: { type: 'join', gameId: view.game!.id, revision: view.revision } })).json<JunoSnapshot>();
    view = (await app.inject({ method: 'POST', url: url + '?memory=1', headers, payload: { type: 'start', gameId: view.game!.id, revision: view.revision } })).json<JunoSnapshot>();
    expect(view.game?.memoryEnabled).toBe(false);
    expect((await app.inject({ method: 'GET', url, headers })).statusCode).toBe(200);
    for (const query of ['?memory=0', '?memory=1&memory=1', '?memory=anything', '?memory=1&secret=1']) {
      expect((await app.inject({ method: 'GET', url: url + query, headers })).statusCode).toBe(400);
    }
  });
  it('supports four players and four spectators sharing an IP without spending the ordinary HTTP budget', async () => {
    await app.close(); app = Fastify();
    await app.register(rateLimit, { max: 200, timeWindow: '1 minute', keyGenerator: request => request.ip,
      allowList: () => false });
    app.get('/ordinary-request', async () => ({ ok: true }));
    await app.register(junoRoutes);
    // 60 public moves + 12 fallback polls per viewer in one minute = 576 reads.
    for (let viewer = 0; viewer < 8; viewer++) {
      for (let read = 0; read < 72; read++) {
        const reply = await app.inject({ method: 'GET', url: url + (read % 2 ? '?memory=1' : ''), headers: { authorization: `viewer-${viewer}` } });
        expect(reply.statusCode).toBe(200);
      }
    }
    expect((await app.inject({ method: 'GET', url: '/ordinary-request' })).statusCode).toBe(200);
    for (let read = 576; read < 600; read++) expect((await app.inject({ method: 'GET', url, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url, headers })).statusCode).toBe(429);
    // Authentication and command budgets are not relaxed with the read budget.
    expect((await create()).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url, headers: { authorization: 'different-address' }, remoteAddress: '192.0.2.45' })).statusCode).toBe(200);
  });
  it('does not register the retired account-merge event', async () => {
    expect(app.server.listenerCount('juno:account-merged')).toBe(0);
    expect(app.server.emit('juno:account-merged', 'old-stub', 'retained-account')).toBe(false);
    expect((await create()).statusCode).toBe(200);
    await app.close();
    expect(app.server.listenerCount('juno:account-merged')).toBe(0);
  });
  it('requires auth, membership, channel permissions, voice ownership and a human', async () => {
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    state.member = false; expect((await create()).statusCode).toBe(403); state.member = true;
    state.permission = false; expect((await create()).statusCode).toBe(403); state.permission = true;
    state.room = 'other'; expect((await create()).json().code).toBe('juno_voice_required'); state.room = 'voice';
    state.socket = 3; expect((await create()).json().code).toBe('juno_voice_required'); state.socket = 1;
    state.bot = true; expect((await create()).statusCode).toBe(403);
  });
  it('uses the authenticated host row, rejects stale commands and sends non-secret invalidations', async () => {
    const response = await create(); expect(response.statusCode).toBe(200);
    const snapshot = response.json<JunoSnapshot>(); expect(snapshot.game!.hostId).toBe('remote-row');
    expect(state.changed).toHaveBeenCalledWith('space', 'voice', { type: 'juno_updated', channelId: 'voice' });
    const stale = await app.inject({ method: 'POST', url, headers, payload: { type: 'leave', gameId: snapshot.game!.id, revision: snapshot.revision - 1 } });
    expect(stale.statusCode).toBe(409); expect(stale.json().code).toBe('juno_stale');
    const left = await app.inject({ method: 'POST', url, headers, payload: { type: 'leave', gameId: snapshot.game!.id, revision: snapshot.revision } });
    expect(left.json().game).toBeNull();
  });
  it('rejects malformed commands before touching the game', async () => {
    for (const payload of [{ type: 'cheat' }, { type: 'play', gameId: 'x', revision: -1, cardId: 'a' },
      { type: 'join' }, { type: 'create', xp: 999 }, { type: 'create', userId: 'fake' },
      { type: 'create', recipientIds: { 'remote-row': 'someone-else' } },
      { type: 'create', computer: 1 }, { type: 'removeBot', gameId: 'x', revision: 1 },
      { type: 'report', gameId: 'x', revision: 1, targetUserId: 'someone' },
      { type: 'report', gameId: 'x', revision: 1, opportunityId: 'window' },
      { type: 'report', gameId: 'x', revision: 1, targetUserId: 'someone', opportunityId: 'x'.repeat(65) },
      { type: 'report', gameId: 'x', revision: 1, targetUserId: 'someone', opportunityId: 'window', reporterId: 'fake' },
      { type: 'play', gameId: 'x', revision: 1, cardId: 'x', color: 'purple' }]) {
      expect((await app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'GET', url, headers })).json().game).toBeNull();
  });
  it('uses the existing revision/voice/host gate to manage only ephemeral computer seats', async () => {
    let snapshot = (await create()).json<JunoSnapshot>();
    const send = (payload: object, authorization = 'remote-row') => app.inject({ method: 'POST', url, headers: { authorization },
      payload: { gameId: snapshot.game!.id, revision: snapshot.revision, ...payload } });
    expect((await send({ type: 'addBot' }, 'visitor')).json().code).toBe('juno_host_required');
    snapshot = (await send({ type: 'addBot' })).json<JunoSnapshot>();
    const bot = snapshot.game!.players.find(p => p.computer)!;
    expect(bot.computer).toBe(1); expect(snapshot.game!.supportsBots).toBe(true);
    expect((await send({ type: 'removeBot', botId: 'remote-row' })).json().code).toBe('juno_invalid_move');
    state.socket = 3; expect((await send({ type: 'removeBot', botId: bot.userId })).statusCode).toBe(403); state.socket = 1;
    snapshot = (await send({ type: 'removeBot', botId: bot.userId })).json<JunoSnapshot>();
    expect(snapshot.game!.players).toHaveLength(1); expect(snapshot.game!.practice).toBe(false);
  });
  it('accepts bounded report ids using only the authenticated host-instance reporter', async () => {
    const snapshot = (await create()).json<JunoSnapshot>();
    const command = vi.spyOn(JunoRooms.prototype, 'command').mockReturnValue(snapshot);
    try {
      const payload = { type: 'report', gameId: snapshot.game!.id, revision: snapshot.revision, targetUserId: 'opponent', opportunityId: 'miss-1' };
      expect((await app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(200);
      expect(command).toHaveBeenCalledWith('voice', { userId: 'remote-row', name: 'Alice' }, payload, false);
      state.room = 'other'; expect((await app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(403);
      expect(command).toHaveBeenCalledTimes(1);
    } finally { command.mockRestore(); }
  });
});
