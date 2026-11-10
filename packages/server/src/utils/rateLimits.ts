import type { FastifyReply } from 'fastify';
import type { RateLimitScope } from '@veyvox/shared/src/retryAfter';
import type { ServerEvent } from '@veyvox/shared';
import { errorBody, errorText } from './httpErrors.js';
import { createTokenBucketLimit } from './tokenBucketLimit.js';

export const MESSAGE_CREATE_LIMIT = { capacity: 12, refillPerSecond: 2 } as const;
export const REACTION_LIMIT = { capacity: 20, refillPerSecond: 5 } as const;
const messages = createTokenBucketLimit(MESSAGE_CREATE_LIMIT);
const reactions = createTokenBucketLimit(REACTION_LIMIT);
const ephemeral = createTokenBucketLimit({ capacity: 60, refillPerSecond: 10 });
const controls = createTokenBucketLimit({ capacity: 60, refillPerSecond: 10 });
const EPHEMERAL_EVENTS = new Set(['typing_start', 'dm_typing_start', 'activity_update', 'presence_update', 'channel_ack', 'mark_unread']);

/** The verified account row on this instance, shared by every tab and transport. */
export const consumeMessageCreate = (userId: string, now?: number): number => messages.consume(userId, now);
export const consumeReaction = (userId: string, now?: number): number => reactions.consume(userId, now);

export function consumeWsEvent(userId: string, type: unknown, now?: number): number {
  return (typeof type === 'string' && EPHEMERAL_EVENTS.has(type) ? ephemeral : controls).consume(userId, now);
}

export function rateLimitEvent(retryAfterMs: number, dmChannelId?: string): Extract<ServerEvent, { type: 'error' }> {
  return { type: 'error', code: 'rate_limited', message: errorText('rate_limited'),
    retryAfter: Math.max(1, Math.ceil(retryAfterMs / 1000)), ...(dmChannelId ? { dmChannelId } : {}) };
}

/** dmChannelId on an error means a call refusal, not the target of arbitrary DM traffic. */
export function wsEventRateLimitError(retryAfterMs: number, event: Record<string, unknown>): Extract<ServerEvent, { type: 'error' }> {
  const isCallRequest = event.type === 'dm_call_start' || event.type === 'dm_call_accept';
  const callId = isCallRequest ? (typeof event.dmChannelId === 'string' ? event.dmChannelId
    : typeof event.federatedCallId === 'string' ? event.federatedCallId : undefined) : undefined;
  return rateLimitEvent(retryAfterMs, callId);
}

export function sendRateLimit(reply: FastifyReply, retryAfterMs: number, scope: RateLimitScope = 'resource'): FastifyReply {
  const retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000));
  reply.header('Retry-After', retryAfter);
  return reply.code(429).send({ ...errorBody(429, 'rate_limited'), retryAfter, rateLimitScope: scope });
}

/** Tests only; production reservations survive socket/tab reconnects. */
export function _resetActionLimits(): void { messages.reset(); reactions.reset(); ephemeral.reset(); controls.reset(); }
