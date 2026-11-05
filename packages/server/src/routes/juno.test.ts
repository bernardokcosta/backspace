import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JunoSnapshot } from '@backspace/shared/src/juno.js';

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
import { junoRoutes } from './juno.js';
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
      { type: 'join' }, { type: 'play', gameId: 'x', revision: 1, cardId: 'x', color: 'purple' }]) {
      expect((await app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'GET', url, headers })).json().game).toBeNull();
  });
});
