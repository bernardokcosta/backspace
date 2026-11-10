import type { FastifyInstance, FastifyReply } from 'fastify';
import { sendRateLimit } from '../utils/rateLimits.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { applyReactionAdd, applyReactionRemove, type ReactionOutcome } from '../ws/events.js';

const EMOJI_MAX_LENGTH = 64;

/**
 * REST twins of the WS `reaction_add` / `reaction_remove` events, so a client
 * that only makes HTTP calls can react. One path serves space and DM messages
 * (the kind is found by the message id), through the same functions the WS
 * handlers use. Both calls are idempotent: `changed` says whether anything moved.
 */
export async function reactionRoutes(app: FastifyInstance): Promise<void> {
  const answer = (reply: FastifyReply, outcome: ReactionOutcome): FastifyReply => {
    if (outcome.ok) return reply.send({ success: true, changed: outcome.changed });
    if (outcome.reason === 'rate_limited') return sendRateLimit(reply, outcome.retryAfterMs, 'action');
    if (outcome.reason === 'missing_permission') {
      return sendError(reply, 403, 'missing_permission', { permission: 'ADD_REACTIONS' });
    }
    if (outcome.reason === 'read_only') return sendError(reply, 403, 'not_dm_member');
    return sendError(reply, 404, 'message_not_found');
  };

  const emojiProblem = (emoji: string): boolean => emoji.length === 0 || emoji.length > EMOJI_MAX_LENGTH;

  app.put<{ Params: { id: string; emoji: string } }>('/api/messages/:id/reactions/:emoji', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id, emoji } = request.params;
    if (emojiProblem(emoji)) {
      return sendError(reply, 400, 'validation_failed', { field: 'emoji', reason: `must be 1 to ${EMOJI_MAX_LENGTH} characters` });
    }
    return answer(reply, applyReactionAdd(id, emoji, request.userId));
  });

  app.delete<{ Params: { id: string; emoji: string } }>('/api/messages/:id/reactions/:emoji', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id, emoji } = request.params;
    if (emojiProblem(emoji)) {
      return sendError(reply, 400, 'validation_failed', { field: 'emoji', reason: `must be 1 to ${EMOJI_MAX_LENGTH} characters` });
    }
    return answer(reply, applyReactionRemove(id, emoji, request.userId));
  });
}
