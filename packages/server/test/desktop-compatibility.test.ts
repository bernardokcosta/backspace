import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { bootTwoInstances, type TwoInstanceHarness } from './helpers/twoInstanceHarness.js';
import { registerLocal, type TestUser } from './helpers/testUsers.js';
import { openInspector } from './helpers/dbInspect.js';

const OLD = 'Mozilla/5.0 Electron/45.0.0 BackspaceFork/1.15.0';
const CURRENT = 'Mozilla/5.0 Electron/45.0.0 BackspaceFork/1.15.1';
const BROWSER = 'Mozilla/5.0 Chrome/156.0.0.0 Safari/537.36';

describe('desktop compatibility on real HTTP, raw tus and WebSocket seams', () => {
  let h: TwoInstanceHarness; let user: TestUser; let botToken: string;
  const saved = process.env.BACKSPACE_MIN_DESKTOP_VERSION;
  beforeAll(async () => {
    process.env.BACKSPACE_MIN_DESKTOP_VERSION = '1.15.1';
    try { h = await bootTwoInstances({ enableLiveKit: true }); }
    finally {
      if (saved === undefined) delete process.env.BACKSPACE_MIN_DESKTOP_VERSION;
      else process.env.BACKSPACE_MIN_DESKTOP_VERSION = saved;
    }
    user = await registerLocal(h.home, 'policy');
    const response = await fetch(`${h.home.origin}/api/bots`, { method: 'POST',
      headers: { authorization: `Bearer ${user.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'policy_bot' }) });
    expect(response.status, await response.clone().text()).toBe(201);
    botToken = (await response.json() as { token: string }).token;
  }, 120_000);
  afterAll(async () => { await h?.cleanup(); });

  function headers(ua = OLD, token = user.token) { return { 'user-agent': ua, authorization: `Bearer ${token}`, 'content-type': 'application/json' }; }

  it('keeps public policy and recovery readable from an old shell', async () => {
    const response = await fetch(`${h.home.origin}/api/instance/info`, { headers: headers() });
    expect(response.status).toBe(200);
    expect((await response.json() as { minimumDesktopVersion: string }).minimumDesktopVersion).toBe('1.15.1');
  });

  it('refuses human registration/login and authenticated/optional mutations without writing', async () => {
    const login = await fetch(`${h.home.origin}/api/auth/login`, { method: 'POST', headers: headers(), body: JSON.stringify({ username: user.username, password: user.password }) });
    expect(login.status).toBe(426);
    const name = 'blocked_policy_registration';
    const registration = await fetch(`${h.home.origin}/api/auth/register`, { method: 'POST', headers: headers(), body: JSON.stringify({ username: name, password: 'test-only-good-password' }) });
    expect(registration.status).toBe(426);
    const inspector = openInspector(h.home);
    try { expect(inspector.userByUsername(name) ?? null).toBeNull(); } finally { inspector.close(); }
    const update = await fetch(`${h.home.origin}/api/users/@me`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ displayName: 'Must not be stored' }) });
    expect(update.status).toBe(426);
    expect(await update.json()).toMatchObject({ code: 'desktop_update_required', details: { minimumVersion: '1.15.1', currentVersion: '1.15.0' } });
    const optional = await fetch(`${h.home.origin}/api/sticker-store/packs`, { headers: headers() });
    expect(optional.status).toBe(426);
  });

  it('keeps invalid credentials unauthorized and accepts browsers/current desktops/real bot tokens', async () => {
    expect((await fetch(`${h.home.origin}/api/users/@me`, { headers: headers(OLD, 'invalid-token') })).status).toBe(401);
    for (const ua of [BROWSER, CURRENT]) expect((await fetch(`${h.home.origin}/api/users/@me`, { headers: headers(ua) })).status).toBe(200);
    expect((await fetch(`${h.home.origin}/api/users/@me`, { headers: headers(OLD, botToken) })).status).toBe(200);
    const unknown = await fetch(`${h.home.origin}/api/users/@me`, { headers: headers('Mozilla/5.0 Electron/45.0.0') });
    expect(unknown.status).toBe(426);
    expect((await unknown.json() as { details: object }).details).not.toHaveProperty('currentVersion');
  });

  it('refuses raw tus create/PATCH/HEAD/DELETE before upload state is modified', async () => {
    const tus = { ...headers(), 'content-type': 'application/offset+octet-stream', 'tus-resumable': '1.0.0', 'upload-length': '512', 'upload-metadata': `originalName ${Buffer.from('test.png').toString('base64')}` };
    expect((await fetch(`${h.home.origin}/api/files`, { method: 'POST', headers: tus })).status).toBe(426);
    const create = await fetch(`${h.home.origin}/api/files`, { method: 'POST', headers: { ...tus, 'user-agent': CURRENT } });
    expect(create.status).toBe(201);
    const location = new URL(create.headers.get('location')!, h.home.origin);
    for (const method of ['PATCH', 'HEAD', 'DELETE']) {
      expect((await fetch(location, { method, headers: { ...headers(), 'tus-resumable': '1.0.0', 'upload-offset': '0', 'content-type': 'application/offset+octet-stream' },
        ...(method === 'PATCH' ? { body: new Uint8Array([1]) } : {}) })).status).toBe(426);
    }
    const remaining = await fetch(location, { method: 'HEAD', headers: { ...headers(CURRENT), 'tus-resumable': '1.0.0' } });
    expect(remaining.status).toBe(200); expect(remaining.headers.get('upload-offset')).toBe('0');
  });

  it('refuses livekit token acquisition through the authenticated compatibility seam', async () => {
    const response = await fetch(`${h.home.origin}/api/livekit/token`, { method: 'POST', headers: headers(), body: JSON.stringify({ channelId: 'nonexistent' }) });
    expect(response.status).toBe(426);
  });

  it('refuses the unsupported socket before ready and does not eject a simultaneous valid browser socket', async () => {
    const browser = new WebSocket(`${h.home.origin.replace('http:', 'ws:')}/ws`, { headers: { 'user-agent': BROWSER } });
    const ready = new Promise<void>((resolve, reject) => {
      browser.once('open', () => browser.send(JSON.stringify({ type: 'auth', token: user.token })));
      browser.on('message', (data) => { if ((JSON.parse(data.toString()) as { type: string }).type === 'ready') resolve(); });
      browser.once('error', reject);
    });
    await ready;
    const events: Array<{ type: string; code?: string }> = [];
    const old = new WebSocket(`${h.home.origin.replace('http:', 'ws:')}/ws`, { headers: { 'user-agent': OLD } });
    try {
      const code = await new Promise<number>((resolve, reject) => {
        old.once('open', () => old.send(JSON.stringify({ type: 'auth', token: user.token, clientKind: 'bot' })));
        old.on('message', (data) => events.push(JSON.parse(data.toString()) as { type: string; code?: string }));
        old.once('close', resolve); old.once('error', reject);
      });
      expect(code).toBe(4406);
      expect(events.some((event) => event.type === 'ready')).toBe(false);
      expect(events).toContainEqual(expect.objectContaining({ type: 'error', code: 'desktop_update_required' }));
      expect(browser.readyState).toBe(WebSocket.OPEN);
    } finally { old.terminate(); browser.terminate(); }
  }, 10_000);
});
