import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { buildOldDatabase } from '../src/testing/standaloneUpgrade.js';
import { hashSync } from 'bcryptjs';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../src/db/schema.js';
import { PermissionBits } from '@veyvox/shared/src/permissions.js';
import { spawnInstance, readInstanceLog, stopInstance, type SpawnedInstance } from './helpers/instanceHarness.js';
import { registerLocal, type TestUser } from './helpers/testUsers.js';
import { connectWs } from './helpers/wsListener.js';

vi.setConfig({ testTimeout: 30_000 });
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let runDir: string;
let instance: SpawnedInstance;
let fresh: SpawnedInstance;
let hub: Server;
let hubUrl: string;
let owner: TestUser;
let visitor: TestUser;
const traffic: string[] = [];
const oldError = JSON.stringify({ at: 42, status: 'network' });
const nativeSettings = { worker_id: 1, registration_open: 1 };

function seedLegacy(dbPath: string): void {
  const sqlite = new Database(dbPath);
  try {
    const db = drizzle(sqlite, { schema });
    // Seed the exact generated post-core/pre-cleanup boundary, not the latest
    // native schema with re-invented historical columns.
    buildOldDatabase(sqlite, { through: 50 });
    db.insert(schema.instanceSettings).values({ id: 1,
      workerId: 1, instanceName: 'Legacy-enabled fixture', registrationOpen: 1,
      updatedAt: 1 }).run();
    sqlite.prepare(`UPDATE instance_settings SET discovery_enabled=1,directory_enabled=1,directory_browse_enabled=1,
      directory_dirty=1,directory_last_ping_at=123,directory_last_error=?,support_card_enabled=0`).run(oldError);
    db.insert(schema.users).values([
      { id: 'legacy-owner', username: 'legacy_owner', passwordHash: hashSync('fixture-password', 4), isAdmin: 1, createdAt: 1 },
      { id: 'legacy-remote', username: 'retained@old.invalid', passwordHash: 'synthetic-local-credential', createdAt: 1 },
    ]).run();
    for (const [id, visibility] of [['legacy-space', 'public'], ['request-space', 'request']] as const) {
      db.insert(schema.spaces).values({ id, name: id, ownerId: 'legacy-owner', inviteCode: `invite-${id}`,
        visibility, description: 'Retained description', createdAt: 1 }).run();
      sqlite.prepare('UPDATE spaces SET directory_listed=1 WHERE id=?').run(id);
      db.insert(schema.spaceMembers).values({ spaceId: id, userId: 'legacy-owner', joinedAt: 1 }).run();
      db.insert(schema.channels).values({ id: `${id}-channel`, spaceId: id, name: 'welcome', type: 'text', createdAt: 1 }).run();
      db.insert(schema.roles).values({ id, spaceId: id, name: '@everyone',
        permissions: (PermissionBits.VIEW_CHANNEL | PermissionBits.READ_MESSAGE_HISTORY).toString(), createdAt: 1 }).run();
    }
    db.insert(schema.spaceMembers).values({ spaceId: 'legacy-space', userId: 'legacy-remote', joinedAt: 1 }).run();
  } finally { sqlite.close(); }
}

function storedNative() {
  const sqlite = new Database(instance.dbPath, { readonly: true });
  try {
    const columns = sqlite.pragma('table_info(instance_settings)') as Array<{ name: string }>;
    for (const name of ['discovery_enabled', 'directory_enabled', 'directory_browse_enabled', 'directory_dirty', 'support_card_enabled']) {
      expect(columns.map(column => column.name)).not.toContain(name);
    }
    return sqlite.prepare('SELECT worker_id,registration_open FROM instance_settings WHERE id=1').get();
  } finally { sqlite.close(); }
}

async function call(user: TestUser, method: string, url: string, body?: unknown) {
  return fetch(`${instance.origin}${url}`, { method,
    headers: { Authorization: `Bearer ${user.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(async () => {
  // The actual index.ts static registration + API/SPA not-found handler must
  // be active. CI builds web before tests; standalone runs must do so too.
  expect(existsSync(path.resolve(serverDir, '../web/dist/index.html')), 'Run pnpm build before this real static-server test').toBe(true);
  const scratch = path.resolve(serverDir, '../../tests/.tmp');
  await mkdir(scratch, { recursive: true });
  runDir = await mkdtemp(path.join(scratch, 'discovery-retirement-'));
  await mkdir(path.join(runDir, 'uploads'));
  hub = createServer((req, res) => { traffic.push(`${req.method} ${req.url}`); req.resume(); res.writeHead(204).end(); });
  await new Promise<void>(resolve => hub.listen(0, '127.0.0.1', resolve));
  hubUrl = `http://127.0.0.1:${(hub.address() as AddressInfo).port}`;
  const dbPath = path.join(runDir, 'legacy.db'); seedLegacy(dbPath);
  instance = await spawnInstance({ domain: 'retirement.test.local', dbPath, storagePath: path.join(runDir, 'uploads'),
    jwtSecret: randomBytes(32).toString('hex'), logPath: path.join(runDir, 'server.log'),
    environment: { DIRECTORY_ENDPOINT: hubUrl, TELEMETRY_ENDPOINT: hubUrl } });
  const login = await fetch(`${instance.origin}/api/auth/login`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'legacy_owner', password: 'fixture-password' }) });
  expect(login.status).toBe(200);
  const signedIn = await login.json() as { token: string; user: { id: string; username: string } };
  owner = { id: signedIn.user.id, username: signedIn.user.username, password: 'fixture-password', token: signedIn.token, origin: instance.origin };
  visitor = await registerLocal(instance, 'retirement_visitor');
  await mkdir(path.join(runDir, 'fresh-uploads'));
  fresh = await spawnInstance({ domain: 'fresh-retirement.test.local', dbPath: path.join(runDir, 'fresh.db'),
    storagePath: path.join(runDir, 'fresh-uploads'), jwtSecret: randomBytes(32).toString('hex'),
    logPath: path.join(runDir, 'fresh.log'),
    environment: { DIRECTORY_ENDPOINT: hubUrl, TELEMETRY_ENDPOINT: hubUrl } });
}, 90_000);

afterAll(async () => {
  for (const child of [instance, fresh]) {
    if (child) await stopInstance(child);
  }
  if (hub) await new Promise<void>(resolve => hub.close(() => resolve()));
  if (runDir) await rm(runDir, { recursive: true, force: true }); // This suite's fixture only.
});

describe('discovery retirement on the real server with legacy-enabled data', () => {
  it('returns JSON 404 for retired APIs while the SPA fallback still serves HTML', async () => {
    for (const [method, url] of [
      ['GET', '/api/directory'], ['GET', '/api/directory/spaces'], ['GET', '/api/spaces/explore'],
      ['POST', '/api/spaces/legacy-space/public-join'],
      ['GET', '/api/admin/telemetry'], ['PUT', '/api/admin/telemetry'], ['GET', '/api/admin/telemetry/preview'],
    ] as const) {
      const res = await call(owner, method, url);
      expect(res.status, url).toBe(404);
      expect(res.headers.get('content-type'), url).toContain('application/json');
      expect(await res.json()).toHaveProperty('error');
      const anonymous = await fetch(`${instance.origin}${url}`, { method });
      // /spaces/explore now matches the retained /spaces/:id route, whose
      // unauthenticated caller must still pass authentication before lookup.
      expect(anonymous.status, url).toBe(url === '/api/spaces/explore' ? 401 : 404);
      expect(anonymous.headers.get('content-type')).toContain('application/json');
    }
    const spa = await fetch(`${instance.origin}/retired-bookmark-fixture`);
    expect(spa.status).toBe(200); expect(spa.headers.get('content-type')).toContain('text/html');
    expect(await spa.text()).toContain('<!DOCTYPE html>');
  });

  it('omits retired wire fields and ignores legacy PATCH keys without recreating columns or changing native values', async () => {
    const retired = ['discoveryEnabled', 'directoryEnabled', 'directoryBrowseEnabled', 'directoryConfigured',
      'directoryAvailable', 'directoryDirty', 'directoryLastPingAt', 'directoryLastError', 'directoryListedSpaceCount', 'supportCardEnabled'];
    for (const url of ['/api/instance/info', '/api/settings/instance', '/api/settings/streaming']) {
      const res = await call(owner, 'GET', url); expect(res.status).toBe(200);
      const body = await res.json(); for (const key of retired) expect(body, url).not.toHaveProperty(key);
    }
    for (const url of ['/api/settings/instance', '/api/settings/streaming']) {
      const res = await call(owner, 'PATCH', url, { discoveryEnabled: false, directoryEnabled: 'ignored', directoryBrowseEnabled: false,
        directoryDirty: false, directoryLastPingAt: 0, directoryLastError: null, supportCardEnabled: true });
      expect(res.status, url).toBe(200);
      const body = await res.json(); for (const key of retired) expect(body).not.toHaveProperty(key);
    }
    expect(storedNative()).toEqual(nativeSettings);
    const ws = await connectWs(instance.origin, owner.token);
    try {
      const ready = await ws.waitForEvent('ready');
      expect(Array.isArray(ready.spaces)).toBe(true);
      for (const space of ready.spaces as Record<string, unknown>[]) expect(space).not.toHaveProperty('directoryListed');
    } finally { ws.close(); }
  });

  it('preserves private/invite admission and request approval without directory dependencies', async () => {
    const patched = await call(owner, 'PATCH', '/api/spaces/legacy-space', { visibility: 'private', description: 'Updated invitation metadata', directoryListed: 'ignored' });
    expect(patched.status).toBe(200); expect(await patched.json()).not.toHaveProperty('directoryListed');
    expect((await call(visitor, 'GET', '/api/spaces/legacy-space')).status).toBe(403);
    expect((await call(visitor, 'POST', '/api/spaces/join', { inviteCode: 'invite-legacy-space' })).status).toBe(200);
    expect((await call(visitor, 'GET', '/api/spaces/legacy-space')).status).toBe(200);
    expect((await call(visitor, 'POST', '/api/spaces/join', { inviteCode: 'invite-request-space' })).status).toBe(403);
    const requested = await call(visitor, 'POST', '/api/spaces/request-space/request-join', { message: 'From an invitation' });
    expect(requested.status).toBe(201);
    const req = await requested.json() as { id: string };
    expect((await call(visitor, 'GET', '/api/spaces/request-space/join-requests')).status).toBe(403);
    const ws = await connectWs(instance.origin, visitor.token);
    try {
      const approved = await call(owner, 'PATCH', `/api/spaces/request-space/join-requests/${req.id}`, { action: 'accept' });
      expect(approved.status).toBe(200);
      const event = await ws.waitForEvent('join_request_accepted');
      expect(event.space).toMatchObject({ id: 'request-space', channels: [{ id: 'request-space-channel' }] });
      expect(event.space).not.toHaveProperty('directoryListed');
    } finally { ws.close(); }
    const sqlite = new Database(instance.dbPath, { readonly: true });
    try {
      expect((sqlite.pragma('table_info(spaces)') as Array<{ name: string }>).map(column => column.name)).not.toContain('directory_listed');
      expect(sqlite.prepare('SELECT user_id FROM space_members WHERE space_id = ? AND user_id = ?').get('legacy-space', 'legacy-remote')).toEqual({ user_id: 'legacy-remote' });
      expect(sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally { sqlite.close(); }
  });

  it('contacts no hub at boot or after settings, space mutation and invite entry', async () => {
    await call(owner, 'PATCH', '/api/settings/instance', { instanceName: 'Retained instance name' });
    await call(owner, 'PATCH', '/api/spaces/request-space', { description: 'A retained description' });
    await delay(3_500); // Beyond the retired pinger's 3 s change debounce.
    expect(traffic).toEqual([]);
    expect(await readInstanceLog(instance)).not.toContain('[directory]');
    expect(await readInstanceLog(fresh)).not.toContain('[directory]');
    expect(storedNative()).toEqual(nativeSettings);
  });

  it('boots and migrates a fresh database with the same inert legacy environment', async () => {
    const res = await fetch(`${fresh.origin}/api/instance/info`);
    expect(res.status).toBe(200); expect(await res.json()).not.toHaveProperty('directoryConfigured');
    const sqlite = new Database(fresh.dbPath, { readonly: true });
    try {
      expect(sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
      const columns = (sqlite.pragma('table_info(instance_settings)') as Array<{ name: string }>).map(column => column.name);
      for (const name of ['discovery_enabled', 'directory_enabled', 'directory_browse_enabled', 'directory_dirty', 'support_card_enabled']) expect(columns).not.toContain(name);
    } finally { sqlite.close(); }
    expect(traffic).toEqual([]);
  });
});
