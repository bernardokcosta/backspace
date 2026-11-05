import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { PermissionBits } from '@backspace/shared/src/permissions.js';
import { isErrorCode } from '@backspace/shared/src/errors.js';
import type { JunoCommand } from '@backspace/shared/src/juno.js';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { isMember, isBanned, hasPermission } from '../utils/permissions.js';
import { sendError } from '../utils/httpErrors.js';
import { createFixedWindowLimit } from '../utils/fixedWindowLimit.js';
import { connectionManager } from '../ws/handler.js';
import { JunoRooms, JunoError } from '../games/juno.js';
import { JUNO_ACCOUNT_MERGED_EVENT, hydrateJunoSnapshot, readJunoRanking, settleJunoRound } from '../games/junoProgression.js';

type Params = { channelId: string };
function accessible(channelId: string, userId: string): boolean {
  const channel = getDb().select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  return !!channel && channel.type === 'voice' && isMember(channel.spaceId, userId)
    && hasPermission(userId, channel.spaceId, PermissionBits.VIEW_CHANNEL, channelId)
    && hasPermission(userId, channel.spaceId, PermissionBits.CONNECT, channelId);
}
function gate(channelId: string, userId: string, reply: FastifyReply): boolean {
  if (!accessible(channelId, userId)) { sendError(reply, 403, 'channel_not_found'); return false; }
  if (connectionManager.getUserRoom(userId)?.roomId !== channelId || connectionManager.getVoiceWs(userId)?.readyState !== 1) {
    sendError(reply, 403, 'juno_voice_required'); return false;
  }
  return true;
}
const commandSchema = {
  type: 'object', required: ['type'], additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['create', 'join', 'leave', 'start', 'rematch', 'draw', 'pass', 'play', 'announce', 'addBot', 'removeBot'] },
    gameId: { type: 'string', minLength: 1, maxLength: 64 }, revision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    cardId: { type: 'string', minLength: 1, maxLength: 64 }, color: { type: 'string', enum: ['coral', 'amber', 'mint', 'sky'] },
    announce: { type: 'boolean' },
    botId: { type: 'string', minLength: 1, maxLength: 64 },
  },
  allOf: [
    { if: { properties: { type: { not: { const: 'create' } } } }, then: { required: ['gameId', 'revision'] } },
    { if: { properties: { type: { const: 'play' } } }, then: { required: ['cardId'] } },
    { if: { properties: { type: { const: 'removeBot' } } }, then: { required: ['botId'] } },
  ],
};

export async function junoRoutes(app: FastifyInstance): Promise<void> {
  const creates = createFixedWindowLimit({ max: 5, windowMs: 60_000 });
  const actions = createFixedWindowLimit({ max: 60, windowMs: 60_000 });
  const rooms = new JunoRooms({
    spaceIdForChannel: channelId => getDb().select().from(schema.channels).where(eq(schema.channels.id, channelId)).get()?.spaceId ?? null,
    settle: input => {
      try { return settleJunoRound(input); }
      catch (error) {
        app.log.error('Juno settlement failed; retaining the pending result for retry');
        throw error;
      }
    },
    // A closed socket still has its seat during the existing voice grace.
    present: (channelId, userId) => connectionManager.getUserRoom(userId)?.roomId === channelId && accessible(channelId, userId),
    changed: channelId => {
      const channel = getDb().select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
      if (channel) connectionManager.sendToChannel(channel.spaceId, channelId, { type: 'juno_updated', channelId });
    },
  });
  const remapRecipient = (sourceId: string, targetId: string) => rooms.remapPendingRecipient(sourceId, targetId);
  app.server.on(JUNO_ACCOUNT_MERGED_EVENT, remapRecipient);
  const timer = setInterval(() => rooms.tick(), 1_000); timer.unref();
  app.addHook('onClose', async () => { clearInterval(timer); app.server.off(JUNO_ACCOUNT_MERGED_EVENT, remapRecipient); rooms.dispose(); });
  const root = '/api/channels/:channelId/juno';
  app.get<{ Params: { spaceId: string }; Querystring: { limit?: number; offset?: number } }>('/api/spaces/:spaceId/juno/ranking', {
    preHandler: authenticate,
    preValidation: async (request, reply) => {
      if (Object.keys(request.query).some(key => key !== 'limit' && key !== 'offset')) return sendError(reply, 400, 'invalid_body');
    },
    schema: { querystring: { type: 'object', additionalProperties: false, properties: {
      limit: { type: 'integer', minimum: 1, maximum: 50 }, offset: { type: 'integer', minimum: 0, maximum: 1_000_000 },
    } } },
  }, async (request, reply) => {
    const { spaceId } = request.params;
    const user = getDb().select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user || user.isDeleted || user.isBot || !isMember(spaceId, request.userId) || isBanned(spaceId, request.userId)) return sendError(reply, 403, 'forbidden');
    reply.header('Cache-Control', 'no-store');
    return readJunoRanking(spaceId, request.userId, { limit: request.query.limit ?? 25, offset: request.query.offset ?? 0 });
  });
  app.get<{ Params: Params }>(root, { preHandler: authenticate }, async (request, reply) => {
    if (!gate(request.params.channelId, request.userId, reply)) return;
    const user = getDb().select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user || user.isDeleted || user.isBot) return sendError(reply, 403, 'forbidden');
    reply.header('Cache-Control', 'no-store');
    const spaceId = getDb().select().from(schema.channels).where(eq(schema.channels.id, request.params.channelId)).get()!.spaceId;
    return hydrateJunoSnapshot(rooms.read(request.params.channelId, request.userId), spaceId);
  });
  app.post<{ Params: Params; Body: JunoCommand }>(root, {
    preHandler: authenticate, bodyLimit: 2048, schema: { body: commandSchema },
    preValidation: async (request, reply) => {
      if (request.body && typeof request.body === 'object'
        && Object.keys(request.body).some(key => !Object.hasOwn(commandSchema.properties, key))) return sendError(reply, 400, 'invalid_body');
    },
  }, async (request, reply) => {
    const { channelId } = request.params;
    if (!gate(channelId, request.userId, reply)) return;
    const user = getDb().select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user || user.isDeleted || user.isBot) return sendError(reply, 403, 'forbidden');
    if (!actions.consume(request.userId) || (request.body.type === 'create' && !creates.consume(request.userId))) {
      return sendError(reply, 429, 'rate_limited');
    }
    reply.header('Cache-Control', 'no-store');
    try {
      const spaceId = getDb().select().from(schema.channels).where(eq(schema.channels.id, channelId)).get()!.spaceId;
      return hydrateJunoSnapshot(rooms.command(channelId, { userId: request.userId, name: user.displayName ?? user.username }, request.body), spaceId);
    } catch (error) {
      if (!(error instanceof JunoError) || !isErrorCode(error.message)) throw error;
      return sendError(reply, error.message === 'juno_stale' || error.message === 'juno_exists' ? 409 : 400, error.message);
    }
  });
}
