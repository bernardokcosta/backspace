import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.mock('../utils/auth.js', () => ({
  authenticate: async (req: FastifyRequest, reply: FastifyReply) => { if (!req.headers.authorization) reply.code(401).send(); },
  requireAdmin: async (req: FastifyRequest, reply: FastifyReply) => { if (req.headers.authorization !== 'Bearer admin') reply.code(403).send(); },
}));
import { diagnosticRoutes } from './diagnostics.js';
import { DiagnosticLogStore } from '../utils/diagnosticLogs.js';

let app: FastifyInstance; let directory: string;
const event = { event: 'runtime-error', subsystem: 'app', level: 'error', version: '1.15.9' };
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backspace-diag-route-'));
  app = Fastify(); await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
  await app.register(diagnosticRoutes, { store: new DiagnosticLogStore(directory) });
});
afterEach(async () => { await app.close(); fs.rmSync(directory, { recursive: true, force: true }); });

describe('bounded untrusted diagnostic ingestion', () => {
  it('accepts only safe fields and exposes statistics only through admin hooks', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/diagnostics', payload: { events: [{ ...event, token: 'secret', message: 'private message' }] } })).statusCode).toBe(204);
    const logs = fs.readdirSync(directory).map(file => fs.readFileSync(path.join(directory, file), 'utf8')).join('');
    expect(logs).toContain('"source":"client"'); expect(logs).not.toMatch(/secret|private message/);
    expect((await app.inject('/api/admin/diagnostics')).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/admin/diagnostics', headers: { authorization: 'Bearer user' } })).statusCode).toBe(403);
    const admin = await app.inject({ url: '/api/admin/diagnostics', headers: { authorization: 'Bearer admin' } });
    expect(admin.json().diagnostics.maxBytes).toBe(4_500_000_000);
  });
  it('rejects malformed, forged server events, oversized bodies and excessive batches', async () => {
    for (const payload of [null, {}, { events: [] }, { events: Array(11).fill(event) }, { events: [{ ...event, event: 'server-log' }] },
      { events: [{ ...event, level: { toString: null, valueOf: null } }] }]) {
      expect((await app.inject({ method: 'POST', url: '/api/diagnostics', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'POST', url: '/api/diagnostics', payload: { events: [event], extra: 'x'.repeat(17_000) } })).statusCode).toBe(413);
    expect(fs.readdirSync(directory)).toEqual([]);
  });
  it('limits per-address bursts independently of the storage budget', async () => {
    for (let i = 0; i < 12; i++) expect((await app.inject({ method: 'POST', url: '/api/diagnostics', payload: { events: [event] } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: '/api/diagnostics', payload: { events: [event] } })).statusCode).toBe(429);
  });
  it('limits aggregate bytes across different addresses', async () => {
    let status = 204;
    for (let i = 0; i < 20 && status === 204; i++) {
      status = (await app.inject({ method: 'POST', url: '/api/diagnostics', remoteAddress: `10.0.0.${i + 1}`,
        payload: { events: [event], ignored: 'x'.repeat(16_000) } })).statusCode;
    }
    expect(status).toBe(429);
  });
});
