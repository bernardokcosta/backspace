import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { spawnInstance, stopInstance, type SpawnedInstance } from './helpers/instanceHarness.js';

const retired = [
  ['POST', '/api/auth/attach-proof'], ['POST', '/api/users/@me/reattach'],
  ['GET', '/api/users/@me/federation-registry'], ['PUT', '/api/users/@me/federation-registry'],
  ['POST', '/api/users/@me/federation-credential'], ['POST', '/api/users/@me/federation-identity/delete'],
  ['GET', '/api/admin/users/instances'], ['GET', '/api/admin/blocked-bots'], ['DELETE', '/api/admin/blocked-bots/unused.invalid/member'],
  ['POST', '/api/admin/test/seed-peer'], ['POST', '/api/admin/test/bot-revocations/run'], ['POST', '/api/admin/test/federation/resync'],
  ['GET', '/api/admin/federation/stickers/peers'], ['PUT', '/api/admin/federation/stickers/peers/unused.invalid/policy'],
  ['GET', '/api/admin/federation/stickers/remote-packs'], ['POST', '/api/admin/federation/stickers/sync'],
  ['POST', '/api/federation/stickers/packs/list'], ['POST', '/api/federation/stickers/packs/get'],
  ['GET', '/api/federation/peers'], ['GET', '/api/federation/reset-events'], ['POST', '/api/federation/reset-events/acknowledge'],
  ['DELETE', '/api/federation/peers/absent'], ['PATCH', '/api/federation/peers/absent'], ['DELETE', '/api/federation/peers/absent/permanent'],
  ['POST', '/api/federation/peers/absent/reset'], ['POST', '/api/federation/peers/absent/recheck'], ['POST', '/api/federation/peers/absent/rotate'],
  ['POST', '/api/federation/peer/initiate'], ['POST', '/api/federation/peer/accept'], ['POST', '/api/federation/peer/ensure'],
  ['POST', '/api/federation/peer/rotate'], ['POST', '/api/federation/peer/denied'], ['DELETE', '/api/federation/identity'],
  ['POST', '/api/federation/relay'], ['POST', '/api/federation/epoch'], ['POST', '/api/federation/sync'],
  ['POST', '/api/federation/verify-attach-proof'], ['POST', '/api/federation/users/lookup'], ['POST', '/api/federation/users/by-home-id'],
  ['GET', '/api/federation/approval-requests'], ['POST', '/api/federation/approval-requests/absent/approve'], ['POST', '/api/federation/approval-requests/absent/deny'],
  ['GET', '/api/federation/peering-subscriptions'], ['DELETE', '/api/federation/peering-subscriptions/absent'],
  ['GET', '/api/federation/peering-notifications'], ['POST', '/api/federation/peering-notifications/absent/read'], ['POST', '/api/federation/peering-notifications/read-all'],
] as const;
let instance: SpawnedInstance | undefined;
let directory: string, probe: string, token: string, id: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'veyvox-standalone-absence-')); probe = path.join(directory, 'network.txt'); await writeFile(probe, '');
  const storagePath = path.join(directory, 'uploads'); await mkdir(storagePath);
  instance = await spawnInstance({ domain: 'native.invalid', dbPath: path.join(directory, 'db.sqlite'), storagePath, logPath: path.join(directory, 'server.log'), jwtSecret: crypto.randomBytes(32).toString('hex'), environment: {
    ENABLE_TEST_ROUTES: '1', FEDERATION_BACKOFF_DIVISOR: 'invalid', FEDERATION_ALLOW_PRIVATE_PEERS: 'true',
    NODE_OPTIONS: `--import=${pathToFileURL(path.resolve('test/helpers/networkProbe.mjs')).href}`, TEST_NETWORK_PROBE_PATH: probe,
  } });
  const registration = await fetch(`${instance.origin}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'native_admin', password: 'synthetic-native-password' }) });
  expect(registration.status).toBe(201); const body = await registration.json() as { token: string; user: { id: string } }; token = body.token; id = body.user.id;
  await writeFile(probe, '');
}, 90_000);
afterAll(async () => { if (instance) await stopInstance(instance); if (directory) await rm(directory, { recursive: true, force: true }); });
describe('standalone runtime absence, including SPA fallback and enabled test routes', () => {
  it.each(retired)('%s %s is an unregistered JSON404 for anonymous and real admin callers', async (method, url) => {
    for (const authorized of [false, true]) {
      const response = await fetch(`${instance!.origin}${url}`, { method, headers: authorized ? { authorization: `Bearer ${token}` } : {} });
      expect(response.status).toBe(404); expect(response.headers.get('content-type')).toContain('application/json'); expect(await response.json()).toMatchObject({ statusCode: 404 });
    }
  });
  it('still serves the production SPA for a non-API deep link', async () => {
    const response = await fetch(`${instance!.origin}/a/deep/link`); expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/html'); await response.body?.cancel();
  });
  it('rejects a legacy remote-only event after real ready without creating identities or making outgoing DNS/TCP attempts', async () => {
    const socket = new WebSocket(instance!.origin.replace('http:', 'ws:') + '/ws');
    const events: Array<Record<string, unknown>> = [];
    socket.on('message', raw => events.push(JSON.parse(String(raw)) as Record<string, unknown>));
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.send(JSON.stringify({ type: 'auth', token }));
    try {
      await expect.poll(() => events.some(event => event.type === 'ready')).toBe(true);
      const ready = events.find(event => event.type === 'ready')!;
      for (const field of ['activePeerOrigins', 'rejectedPeerOrigins', 'awaitingApprovalPeerOrigins', 'pendingApprovalCount', 'userActivityIdentities']) expect(ready).not.toHaveProperty(field);
      const db = new Database(instance!.dbPath, { readonly: true });
      try {
        const before = db.prepare('SELECT * FROM users ORDER BY id').all();
        socket.send(JSON.stringify({ type: 'federation_peer_ensure', remoteOrigin: 'https://unused.invalid', homeUserId: id }));
        await expect.poll(() => events.some(event => event.type === 'error')).toBe(true);
        expect(db.prepare('SELECT * FROM users ORDER BY id').all()).toEqual(before);
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'federation_%' OR name LIKE 'peer_approval_%' OR name IN ('bot_revocations','blocked_bots','sticker_peer_policies','user_federation_registry','user_federation_credentials'))").all()).toEqual([]);
        expect(await readFile(probe, 'utf8')).toBe('');
      } finally { db.close(); }
    } finally { socket.close(); await new Promise<void>(resolve => socket.once('close', resolve)); }
  });
});
