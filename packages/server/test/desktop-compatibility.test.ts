import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { bootInstance, type SpawnedInstance } from './helpers/instanceHarness.js';
import { registerLocal, type TestUser } from './helpers/testUsers.js';
import Database from 'better-sqlite3';

const OLD = 'Mozilla/5.0 Electron/45.0.0 BackspaceFork/1.15.0';
const CURRENT = 'Mozilla/5.0 Electron/45.0.0 BackspaceFork/1.15.1';
const BROWSER = 'Mozilla/5.0 Chrome/156.0.0.0 Safari/537.36';

describe('desktop access without minimum-version enforcement', () => {
  let instance: SpawnedInstance; let cleanup: (() => Promise<void>) | undefined; let user: TestUser; let botToken: string;
  const saved = process.env.BACKSPACE_MIN_DESKTOP_VERSION;
  beforeAll(async () => {
    process.env.BACKSPACE_MIN_DESKTOP_VERSION = '1.15.1';
    try { ({ instance, cleanup } = await bootInstance({ livekit: { url: 'wss://media.invalid', apiKey: 'key', apiSecret: 'synthetic-secret-at-least-thirty-two-bytes' } })); }
    finally {
      if (saved === undefined) delete process.env.BACKSPACE_MIN_DESKTOP_VERSION;
      else process.env.BACKSPACE_MIN_DESKTOP_VERSION = saved;
    }
    user = await registerLocal(instance, 'policy');
    const response = await fetch(`${instance.origin}/api/bots`, { method: 'POST',
      headers: { authorization: `Bearer ${user.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'policy_bot' }) });
    expect(response.status, await response.clone().text()).toBe(201);
    botToken = (await response.json() as { token: string }).token;
  }, 120_000);
  afterAll(async () => { await cleanup?.(); });

  function headers(ua = OLD, token = user.token) { return { 'user-agent': ua, authorization: `Bearer ${token}`, 'content-type': 'application/json' }; }

  it('does not advertise a version requirement even with a legacy environment setting', async () => {
    const response = await fetch(`${instance.origin}/api/instance/info`, { headers: headers() });
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty('minimumDesktopVersion');
  });

  it('accepts old desktop registration/login and authenticated/optional routes', async () => {
    const login = await fetch(`${instance.origin}/api/auth/login`, { method: 'POST', headers: headers(), body: JSON.stringify({ username: user.username, password: user.password }) });
    expect(login.status).toBe(200);
    const name = 'legacy_desktop_registration';
    const registration = await fetch(`${instance.origin}/api/auth/register`, { method: 'POST', headers: headers(), body: JSON.stringify({ username: name, password: 'test-only-good-password' }) });
    expect(registration.status).toBe(201);
    const db = new Database(instance.dbPath, { readonly: true });
    try { expect(db.prepare('SELECT id FROM users WHERE username=?').get(name)).toBeTruthy(); } finally { db.close(); }
    const update = await fetch(`${instance.origin}/api/users/@me`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ displayName: 'Legacy desktop' }) });
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({ displayName: 'Legacy desktop' });
    const optional = await fetch(`${instance.origin}/api/sticker-store/packs`, { headers: headers() });
    expect(optional.status).toBe(200);
  });

  it('keeps invalid credentials unauthorized and accepts browsers/current desktops/real bot tokens', async () => {
    expect((await fetch(`${instance.origin}/api/users/@me`, { headers: headers(OLD, 'invalid-token') })).status).toBe(401);
    for (const ua of [BROWSER, CURRENT]) expect((await fetch(`${instance.origin}/api/users/@me`, { headers: headers(ua) })).status).toBe(200);
    expect((await fetch(`${instance.origin}/api/users/@me`, { headers: headers(OLD, botToken) })).status).toBe(200);
    const unknown = await fetch(`${instance.origin}/api/users/@me`, { headers: headers('Mozilla/5.0 Electron/45.0.0') });
    expect(unknown.status).toBe(200);
  });

  it('accepts raw tus create/PATCH/HEAD/DELETE from an old shell', async () => {
    const tus = { ...headers(), 'content-type': 'application/offset+octet-stream', 'tus-resumable': '1.0.0', 'upload-length': '512', 'upload-metadata': `originalName ${Buffer.from('test.png').toString('base64')}` };
    const create = await fetch(`${instance.origin}/api/files`, { method: 'POST', headers: tus });
    expect(create.status).toBe(201);
    const location = new URL(create.headers.get('location')!, instance.origin);
    for (const [method, status] of [['PATCH', 204], ['HEAD', 200], ['DELETE', 204]] as const) {
      expect((await fetch(location, { method, headers: { ...headers(), 'tus-resumable': '1.0.0', 'upload-offset': '0', 'content-type': 'application/offset+octet-stream' },
        ...(method === 'PATCH' ? { body: new Uint8Array([1]) } : {}) })).status).toBe(status);
    }
    const remaining = await fetch(location, { method: 'HEAD', headers: { ...headers(CURRENT), 'tus-resumable': '1.0.0' } });
    expect(remaining.status).toBe(404);
  });

  it('reaches ordinary LiveKit channel validation from an old shell', async () => {
    const response = await fetch(`${instance.origin}/api/livekit/token`, { method: 'POST', headers: headers(), body: JSON.stringify({ channelId: 'nonexistent' }) });
    expect(response.status).toBe(404);
  });

  it.each([OLD, 'Mozilla/5.0 Electron/45.0.0'])('delivers ready to %s alongside a browser socket', async (ua) => {
    const browser = new WebSocket(`${instance.origin.replace('http:', 'ws:')}/ws`, { headers: { 'user-agent': BROWSER } });
    const ready = new Promise<void>((resolve, reject) => {
      browser.once('open', () => browser.send(JSON.stringify({ type: 'auth', token: user.token })));
      browser.on('message', (data) => { if ((JSON.parse(data.toString()) as { type: string }).type === 'ready') resolve(); });
      browser.once('error', reject);
    });
    await ready;
    const events: Array<{ type: string; code?: string }> = [];
    const old = new WebSocket(`${instance.origin.replace('http:', 'ws:')}/ws`, { headers: { 'user-agent': ua } });
    try {
      await new Promise<void>((resolve, reject) => {
        old.once('open', () => old.send(JSON.stringify({ type: 'auth', token: user.token, client: 'desktop' })));
        old.on('message', (data) => {
          const event = JSON.parse(data.toString()) as { type: string; code?: string };
          events.push(event);
          if (event.type === 'ready') resolve();
        });
        old.once('close', () => reject(new Error('Desktop closed before ready'))); old.once('error', reject);
      });
      expect(events.some((event) => event.type === 'ready')).toBe(true);
      expect(events.some((event) => event.type === 'error')).toBe(false);
      expect(browser.readyState).toBe(WebSocket.OPEN);
    } finally { old.terminate(); browser.terminate(); }
  }, 10_000);
});
