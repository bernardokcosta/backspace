import rateLimit, { normalizeIP } from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { errorBody } from './httpErrors.js';
import { sendRateLimit } from './rateLimits.js';
import { rateLimitsDisabled } from './tokenBucketLimit.js';

export const clientAddressKey = (request: FastifyRequest): string => normalizeIP(request.ip);

function family(request: FastifyRequest): 'api' | 'assets' | 'uploads' | 'ws' | 'health' {
  const route = request.routeOptions.url ?? request.url.split('?', 1)[0] ?? '';
  if (route === '/api/health') return 'health';
  if (route === '/ws') return 'ws';
  if (route === '/api/files' || route.startsWith('/api/files/')) return 'uploads';
  if (!route.startsWith('/api/') || route.startsWith('/api/uploads/')
      || route.startsWith('/api/game-icons/assets/') || route.startsWith('/api/stickers/assets/')) return 'assets';
  return 'api';
}

const TRANSPORT_MAX = { api: 5000, assets: 12_000, uploads: 6000, ws: 300, health: 120 } as const;

function ordinaryMax(request: FastifyRequest): number {
  if (request.userId) return request.method === 'GET' || request.method === 'HEAD' ? 1200 : 600;
  const kind = family(request);
  return kind === 'api' ? 600 : TRANSPORT_MAX[kind];
}

/** Call before routes: plugin route overrides never replace the early flood guard. */
export async function registerHttpRateLimits(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    hook: 'preHandler',
    max: ordinaryMax,
    timeWindow: 60_000,
    cache: 10_000,
    keyGenerator: request => request.userId
      ? `${request.method === 'GET' || request.method === 'HEAD' ? 'read' : 'write'}:${request.userId}`
      : `${family(request)}:${clientAddressKey(request)}`,
    allowList: rateLimitsDisabled,
    errorResponseBuilder: (_request, context) => ({
      ...errorBody(429, 'rate_limited'),
      retryAfter: Math.max(1, Math.ceil(context.ttl / 1000)),
      rateLimitScope: 'http',
    }),
  });

  // createRateLimit checks a distinct counter without setting the plugin hook's
  // already-ran marker. Both gates must execute, even on an overridden route.
  const admission = app.createRateLimit({
    max: request => TRANSPORT_MAX[family(request)],
    timeWindow: 60_000,
    keyGenerator: request => `${family(request)}:${clientAddressKey(request)}`,
    allowList: rateLimitsDisabled,
  });
  app.addHook('onRequest', async (request, reply) => {
    const result = await admission(request);
    if (!result.isAllowed && result.isExceeded) return sendRateLimit(reply, result.ttl, 'transport');
  });
}
