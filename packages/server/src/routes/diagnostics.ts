import type { FastifyInstance } from 'fastify';
import { normalizeDiagnostic } from '@veyvox/shared/src/diagnostics';
import { authenticate, requireAdmin } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { DiagnosticLogStore, writeDiagnostic } from '../utils/diagnosticLogs.js';

const MAX_BATCH_BYTES_PER_MINUTE = 256 * 1024;

/** Public, non-identifying failure reports, like the existing CSP-report sink. */
export async function diagnosticRoutes(app: FastifyInstance, { store }: { store: DiagnosticLogStore }): Promise<void> {
  let windowStarted = Date.now();
  let acceptedBytes = 0;
  app.post('/api/diagnostics', { bodyLimit: 16_384, config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = request.body as { events?: unknown } | null;
    if (!body || !Array.isArray(body.events) || body.events.length < 1 || body.events.length > 10) {
      return sendError(reply, 400, 'validation_failed');
    }
    const events = body.events.map(normalizeDiagnostic);
    if (events.some(event => !event || event.event.startsWith('server-') || event.event === 'csp-violation')) {
      return sendError(reply, 400, 'validation_failed');
    }
    const now = Date.now();
    if (now - windowStarted >= 60_000 || now < windowStarted) { windowStarted = now; acceptedBytes = 0; }
    const bytes = Buffer.byteLength(JSON.stringify(body));
    if (acceptedBytes + bytes > MAX_BATCH_BYTES_PER_MINUTE) {
      reply.header('Retry-After', '60');
      return sendError(reply, 429, 'rate_limited');
    }
    acceptedBytes += bytes;
    for (const event of events) if (event) writeDiagnostic(store, 'client', event);
    return reply.code(204).send();
  });

  app.get('/api/admin/diagnostics', { preHandler: [authenticate, requireAdmin] }, async () => ({ diagnostics: store.stats() }));
}
