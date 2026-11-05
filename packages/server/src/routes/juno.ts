import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { PermissionBits } from '@backspace/shared/src/permissions.js';
import { isErrorCode } from '@backspace/shared/src/errors.js';
import type { JunoCommand } from '@backspace/shared/src/juno.js';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { isMember, hasPermission } from '../utils/permissions.js';
import { sendError } from '../utils/httpErrors.js';
import { createFixedWindowLimit } from '../utils/fixedWindowLimit.js';
import { connectionManager } from '../ws/handler.js';
import { JunoRooms, JunoError } from '../games/juno.js';

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
    type: { type: 'string', enum: ['create', 'join', 'leave', 'start', 'rematch', 'draw', 'pass', 'play'] },
    gameId: { type: 'string', minLength: 1, maxLength: 64 }, revision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    cardId: { type: 'string', minLength: 1, maxLength: 64 }, color: { type: 'string', enum: ['coral', 'amber', 'mint', 'sky'] },
    announce: { type: 'boolean' },
  },
  allOf: [
    { if: { properties: { type: { not: { const: 'create' } } } }, then: { required: ['gameId', 'revision'] } },
    { if: { properties: { type: { const: 'play' } } }, then: { required: ['cardId'] } },
  ],
};

export async function junoRoutes(app: FastifyInstance): Promise<void> {
  const creates = createFixedWindowLimit({ max: 5, windowMs: 60_000 });
  const actions = createFixedWindowLimit({ max: 60, windowMs: 60_000 });
  const rooms = new JunoRooms({
    // A closed socket still has its seat during the existing voice grace.
    present: (channelId, userId) => connectionManager.getUserRoom(userId)?.roomId === channelId && accessible(channelId, userId),
    changed: channelId => {
      const channel = getDb().select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
      if (channel) connectionManager.sendToChannel(channel.spaceId, channelId, { type: 'juno_updated', channelId });
    },
  });
  const timer = setInterval(() => rooms.tick(), 1_000); timer.unref();
  app.addHook('onClose', async () => { clearInterval(timer); rooms.dispose(); });
  const root = '/api/channels/:channelId/juno';
  app.get<{ Params: Params }>(root, { preHandler: authenticate }, async (request, reply) => {
    if (!gate(request.params.channelId, request.userId, reply)) return;
    const user = getDb().select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user || user.isBot) return sendError(reply, 403, 'forbidden');
    reply.header('Cache-Control', 'no-store');
    return rooms.read(request.params.channelId, request.userId);
  });
  app.post<{ Params: Params; Body: JunoCommand }>(root, {
    preHandler: authenticate, bodyLimit: 2048, schema: { body: commandSchema },
  }, async (request, reply) => {
    const { channelId } = request.params;
    if (!gate(channelId, request.userId, reply)) return;
    const user = getDb().select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user || user.isBot) return sendError(reply, 403, 'forbidden');
    if (!actions.consume(request.userId) || (request.body.type === 'create' && !creates.consume(request.userId))) {
      return sendError(reply, 429, 'rate_limited');
    }
    reply.header('Cache-Control', 'no-store');
    try {
      return rooms.command(channelId, { userId: request.userId, name: user.displayName ?? user.username }, request.body);
    } catch (error) {
      if (!(error instanceof JunoError) || !isErrorCode(error.message)) throw error;
      return sendError(reply, error.message === 'juno_stale' || error.message === 'juno_exists' ? 409 : 400, error.message);
    }
  });
}
