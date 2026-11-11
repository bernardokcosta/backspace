import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { registerHttpRateLimits } from './utils/httpRateLimit.js';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { trustProxyFn } from './utils/trustProxy.js';
import { getDb, getRawDb, closeDatabase } from './db/index.js';
import { checkFfmpeg } from './utils/thumbnail.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { spaceRoutes } from './routes/spaces.js';
import { channelRoutes } from './routes/channels.js';
import { messageRoutes } from './routes/messages.js';
import { pinRoutes } from './routes/pins.js';
import { stickerRoutes } from './routes/stickers.js';
import { soundboardRoutes } from './routes/soundboard.js';
import { junoRoutes } from './routes/juno.js';
import { stickerStoreRoutes } from './routes/stickerStore.js';
import { gameIconRoutes } from './routes/gameIcons.js';
import { uploadRoutes } from './routes/uploads.js';
import { filesRoutes } from './routes/files.js';
import { dmRoutes } from './routes/dm.js';
import { livekitRoutes } from './routes/livekit.js';
import { socialRoutes } from './routes/social.js';
import { settingsRoutes } from './routes/settings.js';
import { notificationSettingsRoutes } from './routes/notificationSettings.js';
import { utilRoutes } from './routes/utils.js';
import { instanceRoutes } from './routes/instance.js';
import { invitesRoutes } from './routes/invites.js';
import { botRoutes } from './routes/bots.js';
import { reactionRoutes } from './routes/reactions.js';
import { botCommandRoutes } from './routes/botCommands.js';
import { interactionRoutes } from './routes/interactions.js';
import { joinRequestRoutes } from './routes/joinRequests.js';
import { searchRoutes } from './routes/search.js';
import { adminRoutes } from './routes/admin.js';
import { adminUpdateRoutes } from './routes/adminUpdates.js';
import { gifRoutes } from './routes/gif.js';
import { cspReportRoutes } from './routes/cspReport.js';
import { diagnosticRoutes } from './routes/diagnostics.js';
import { DiagnosticLogStore, diagnosticLoggerStream, captureServerConsole, writeDiagnostic, installFatalDiagnostics } from './utils/diagnosticLogs.js';
import { buildCspHeaderValue, CSP_REPORT_GROUP, CSP_REPORT_PATH } from './utils/csp.js';
import { startStorageWorker, stopStorageWorker } from './utils/storageWorker.js';
import { startBackupWorker, stopBackupWorker } from './utils/backupWorker.js';
import { resetStalePresenceOnBoot } from './utils/presenceBoot.js';

import { registerWebSocket } from './ws/handler.js';
import path from 'path';
import fs from 'fs';
import { MESSAGE_PAGING_HEADER } from '@veyvox/shared';

async function main(): Promise<void> {
  const diagnosticLogs = new DiagnosticLogStore(path.join(path.dirname(config.dbPath), 'diagnostics'));
  captureServerConsole(diagnosticLogs, config.version);
  installFatalDiagnostics(diagnosticLogs, config.version);
  const app = Fastify({
    // A count of trusted hops, not `true`. `request.ip` is the address the
    // nearest proxy appended rather than the left-most thing in
    // `X-Forwarded-For`, so a client cannot pick the address its rate limits
    // are counted under. `TRUSTED_PROXY_HOPS` in config.ts carries what the
    // number means and when an operator changes it.
    //
    // Fastify 5 no longer accepts the count directly (a number now trusts
    // nothing), so it is expressed as a function with identical hop semantics
    // — see utils/trustProxy.ts.
    trustProxy: trustProxyFn(config.trustedProxyHops),
    logger: {
      level: 'info',
      base: { version: config.version },
      stream: diagnosticLoggerStream(diagnosticLogs),
    },
    logController: new LogController({ disableRequestLogging: (request) =>
      ['/api/health', '/api/diagnostics'].includes(request.url.split('?', 1)[0] ?? '') }),
  });

  // The separately hosted web/desktop client can select this instance on login,
  // so the API supports explicit bearer-authenticated cross-origin requests.
  //
  // Reflecting is safe here only because there is no ambient credential to ride
  // on: this API has no cookies and no HTTP auth, and the bearer token is read
  // from localStorage and attached explicitly by our own client. A cross-origin
  // page cannot obtain it and the browser will not attach it. That premise is
  // enforced by test/cors-posture.test.ts. Access-Control-Allow-Credentials is
  // therefore NOT set: it grants nothing today and would make this reflection
  // genuinely unsafe the moment a cookie appeared.
  // See docs/systems/web-security.md.
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    // Tus-* and Upload-* headers are required for a separately hosted client
    // (cross-origin POST/HEAD/PATCH/DELETE on /api/files/*). Without them the
    // browser preflight blocks the request before it ever reaches the server.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Tus-Resumable',
      'Upload-Length',
      'Upload-Offset',
      'Upload-Metadata',
      'Upload-Defer-Length',
      'Upload-Concat',
      'Upload-Checksum',
      'X-HTTP-Method-Override',
    ],
    // Expose tus response headers so tus-js-client can read them across origins
    // (Location is the per-upload URL returned on POST; the rest are standard
    // tus protocol headers). MESSAGE_PAGING_HEADER acknowledges `after` support.
    exposedHeaders: [
      'Retry-After',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      MESSAGE_PAGING_HEADER,
      'Location',
      'Tus-Resumable',
      'Tus-Version',
      'Tus-Extension',
      'Tus-Max-Size',
      'Tus-Checksum-Algorithm',
      'Upload-Offset',
      'Upload-Length',
      'Upload-Metadata',
      'Upload-Expires',
    ],
  });

  // helmet supplies the static security headers. It is explicitly NOT allowed to
  // manage the CSP: the policy depends on runtime config and has to defer to
  // routes that set their own, so it is applied by the onSend hook below and
  // lives in exactly one place.
  await app.register(helmet, {
    contentSecurityPolicy: false,
    // Only the TLS terminator knows whether HTTPS is actually in play. Caddy
    // owns HSTS; see Caddyfile and docs/systems/web-security.md.
    strictTransportSecurity: false,
    // A separately hosted web/desktop client loads native assets across origins.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    // Not enabled: it would require CORP headers on every third-party image an
    // embed pulls in, which is not something this app controls.
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xFrameOptions: { action: 'deny' },
  });

  // Fastify 5 runs the content-type parser whenever the header is present,
  // even for a request that carries no body bytes; Fastify 4 skipped parsing
  // for GET/HEAD/DELETE/OPTIONS unless length or encoding headers advertised
  // a body. Bots and test doubles (axios/fetch defaults, the e2e `call`
  // helpers) routinely send `Content-Type: application/json` on bodyless
  // requests, which v5 answers with 400 FST_ERR_CTP_EMPTY_JSON_BODY. Drop such
  // a header before parsing to restore the v4 tolerance exactly: only when NO
  // length/encoding headers are present at all. An explicit `Content-Length: 0`
  // still goes to the parser (400), as in v4 — and POST/PUT/PATCH are
  // untouched either way.
  app.addHook('preParsing', async (request, _reply, payload) => {
    const method = request.method;
    if (
      (method === 'GET' || method === 'HEAD' || method === 'DELETE' || method === 'OPTIONS') &&
      request.headers['content-type'] !== undefined &&
      request.headers['transfer-encoding'] === undefined &&
      request.headers['content-length'] === undefined
    ) {
      delete request.headers['content-type'];
    }
    return payload;
  });

  // The policy is built once at boot because its only input is config, which
  // does not change while the process runs.
  const cspHeaderValue = buildCspHeaderValue({ livekitUrl: config.livekit.url });
  // Enforcing since 2026-09-03. It shipped report-only first and was flipped
  // only after the observation phase in docs/systems/web-security.md section 7
  // ran on two real deployments with a violation detector validated on each.
  // `Reporting-Endpoints` and the sink below stay: an enforcing policy still
  // reports, and those reports are now the only signal that this broke a flow
  // nobody exercised.
  const cspHeaderName = 'Content-Security-Policy';
  const reportingEndpoints = `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`;

  app.addHook('onSend', async (_request, reply, payload) => {
    // A route that has already set its own policy is asserting something
    // stricter about its own response than the app policy can. routes/uploads.ts
    // sandboxes served user files under `default-src 'none'`; overwriting that
    // with the app policy would widen it. The guard and the header below now
    // carry the same name, which is why this reads as a plain "first writer
    // wins" rather than as two competing headers.
    if (!reply.getHeader('Content-Security-Policy')) {
      reply.header(cspHeaderName, cspHeaderValue);
      reply.header('Reporting-Endpoints', reportingEndpoints);
    }
    return payload;
  });

  await registerHttpRateLimits(app);

  await app.register(websocket);

  // Serve built frontend in production
  const webDistPath = path.resolve(import.meta.dirname ?? '.', '../../web/dist');
  if (fs.existsSync(webDistPath)) {
    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/',
      wildcard: false,
    });
  }

  // Initialize database
  getDb();

  // The previous process's disconnect timers are gone. Reset stale live status
  // without changing saved chosen status. Must run
  // before WS auth is accepted so the first connection broadcasts the correct
  // online transition. See utils/presenceBoot.ts.
  resetStalePresenceOnBoot();

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(spaceRoutes);
  await app.register(channelRoutes);
  await app.register(messageRoutes);
  await app.register(pinRoutes);
  await app.register(uploadRoutes);
  await app.register(stickerRoutes);
  await app.register(soundboardRoutes);
  await app.register(junoRoutes);
  await app.register(stickerStoreRoutes);
  await app.register(gameIconRoutes);
  await app.register(filesRoutes);
  await app.register(dmRoutes);
  await app.register(livekitRoutes);
  await app.register(socialRoutes);
  await app.register(settingsRoutes);
  await app.register(notificationSettingsRoutes);
  await app.register(utilRoutes);
  await app.register(instanceRoutes);
  await app.register(invitesRoutes);
  await app.register(botRoutes);
  await app.register(reactionRoutes);
  await app.register(botCommandRoutes);
  await app.register(interactionRoutes);
  await app.register(joinRequestRoutes);
  await app.register(searchRoutes);
  await app.register(adminRoutes);
  await app.register(adminUpdateRoutes);
  await app.register(gifRoutes);
  // Registered here rather than beside the hook above so it sits behind the
  // rate limiter. The sink is unauthenticated by design and writes a log line
  // per report, and @fastify/rate-limit only covers routes registered after it.
  await app.register(cspReportRoutes);
  await app.register(diagnosticRoutes, { store: diagnosticLogs });
  await app.register(registerWebSocket);

  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: Date.now() };
  });

  // SPA fallback - serve index.html for non-API routes
  if (fs.existsSync(webDistPath)) {
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'Not found', statusCode: 404 });
      }
      return reply.sendFile('index.html');
    });
  }

  try {
    await app.listen({ port: config.port, host: config.host });
    writeDiagnostic(diagnosticLogs, 'server', { event: 'server-started', subsystem: 'server', level: 'info', version: config.version });
    console.log(`Veyvox server running at http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Log ffmpeg availability at startup (so admins see the warning immediately)
  checkFfmpeg();

  startStorageWorker();

  startBackupWorker();

  const shutdown = async () => {
    writeDiagnostic(diagnosticLogs, 'server', { event: 'server-stopped', subsystem: 'server', level: 'info', version: config.version });
    console.log('Shutting down...');
    stopStorageWorker();
    stopBackupWorker();
    await app.close();
    closeDatabase(); // checkpoints WAL — leaves a complete on-disk file
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
