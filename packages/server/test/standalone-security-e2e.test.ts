import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { bootInstance, type SpawnedInstance } from './helpers/instanceHarness.js';
import { registerLocal, type TestUser } from './helpers/testUsers.js';
import { connectWs, type WsCapture } from './helpers/wsListener.js';
let instance: SpawnedInstance, cleanup: (() => Promise<void>) | undefined;
let admin: TestUser, owner: TestUser, member: TestUser, outsider: TestUser;
let spaceId: string, channelId: string, messageId: string, dmId: string, dmMessageId: string, botId: string;
const sockets: WsCapture[] = [];
async function request(method: string, route: string, token?: string, payload?: unknown): Promise<Response> {
  return fetch(`${instance.origin}/api${route}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(payload === undefined ? {} : { 'content-type': 'application/json' }) }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
}
async function success<T>(method: string, route: string, token?: string, payload?: unknown): Promise<T> {
  const response = await request(method, route, token, payload), body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBeLessThan(300); return body as T;
}
function nativeRows(): unknown {
  const db = new Database(instance.dbPath, { readonly: true });
  try {
    return Object.fromEntries(['spaces', 'space_members', 'channels', 'messages', 'dm_channels', 'dm_members', 'dm_messages',
      'reactions', 'dm_reactions', 'attachments', 'read_states', 'roles', 'member_roles', 'bot_tokens', 'instance_settings']
      .map(table => [table, db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()]));
  } finally { db.close(); }
}
async function authAttempt(token: string): Promise<Array<Record<string, unknown>>> {
  const ws = new WebSocket(`${instance.origin.replace('http:', 'ws:')}/ws`), events: Array<Record<string, unknown>> = [];
  const closed = new Promise<void>(resolve => ws.once('close', () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { reject(new Error('Synthetic auth attempt timed out')); ws.terminate(); }, 3000);
      ws.once('error', error => { clearTimeout(timeout); reject(error); });
      ws.once('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
      ws.on('message', data => { events.push(JSON.parse(String(data)) as Record<string, unknown>); clearTimeout(timeout); resolve(); });
    });
    return events;
  } finally { ws.close(); await closed; }
}
beforeAll(async () => {
  ({ instance, cleanup } = await bootInstance({ livekit: { url: 'wss://media.invalid', apiKey: 'synthetic', apiSecret: 'synthetic-media-secret-at-least-32-bytes' } }));
  admin = await registerLocal(instance, 'security_admin'); owner = await registerLocal(instance, 'security_owner');
  member = await registerLocal(instance, 'security_member'); outsider = await registerLocal(instance, 'security_outsider');
  spaceId = (await success<{ id: string }>('POST', '/spaces', owner.token, { name: 'Private audit space' })).id;
  const detail = await success<{ channels: Array<{ id: string; type: string }> }>('GET', `/spaces/${spaceId}`, owner.token);
  channelId = detail.channels.find(channel => channel.type === 'text')!.id;
  messageId = (await success<{ id: string }>('POST', `/channels/${channelId}/messages`, owner.token, { content: 'Private retained space history' })).id;
  dmId = (await success<{ id: string }>('POST', '/dm', owner.token, { userId: member.id })).id;
  dmMessageId = (await success<{ id: string }>('POST', `/dm/${dmId}/messages`, owner.token, { content: 'Private retained DM history' })).id;
  botId = (await success<{ bot: { id: string } }>('POST', '/bots', owner.token, { name: 'security_bot' })).bot.id;
}, 90_000);
afterAll(async () => { for (const socket of sockets) socket.close(); await cleanup?.(); });
describe('native security matrix at real REST/WS/tus entrypoints', () => {
  it.each(['expired', 'HS384', 'HS512', 'none', 'missing-user', 'missing-name', 'missing-iat', 'missing-exp', 'malformed'] as const)(
    'refuses %s JWT through both REST and WebSocket before any application mutation', async variant => {
      const claims = { userId: outsider.id, username: outsider.username };
      let token: string;
      if (variant === 'malformed') token = 'not-a-session';
      else if (variant === 'missing-user') token = jwt.sign({ username: outsider.username }, instance.jwtSecret, { expiresIn: '1h' });
      else if (variant === 'missing-name') token = jwt.sign({ userId: outsider.id }, instance.jwtSecret, { expiresIn: '1h' });
      else token = jwt.sign(claims, instance.jwtSecret, { ...(variant === 'missing-exp' ? {} : { expiresIn: variant === 'expired' ? -1 : '1h' }),
        ...(variant === 'missing-iat' ? { noTimestamp: true } : {}), ...(['HS384', 'HS512', 'none'].includes(variant) ? { algorithm: variant as 'HS384' | 'HS512' | 'none' } : {}) });
      const before = nativeRows(); const response = await request('GET', '/users/@me', token); expect(response.status).toBe(401); await response.body?.cancel();
      const events = await authAttempt(token); expect(events[0]?.type).toBe('error'); expect(events.some(event => event.type === 'ready')).toBe(false);
      expect(nativeRows()).toEqual(before);
    });
  it('requires authentication and actual admin state, not submitted user IDs or legacy identity fields', async () => {
    for (const token of [undefined, outsider.token]) {
      const before = nativeRows(); const response = await request('PATCH', '/settings/instance', token, {
        instanceName: 'Unauthorized', userId: admin.id, homeUserId: admin.id, homeInstance: instance.origin, isAdmin: true });
      expect(response.status).toBe(token ? 403 : 401); await response.body?.cancel(); expect(nativeRows()).toEqual(before);
    }
  });
  it.each<[string, () => string, unknown, number]>([
    ['GET', () => `/spaces/${spaceId}`, undefined, 403],
    ['PATCH', () => `/spaces/${spaceId}`, { name: 'Stolen' }, 403],
    ['DELETE', () => `/spaces/${spaceId}`, undefined, 403],
    ['GET', () => `/channels/${channelId}/messages`, undefined, 403],
    ['POST', () => `/channels/${channelId}/messages`, { content: 'Forbidden' }, 403],
    ['PATCH', () => `/messages/${messageId}`, { content: 'Stolen' }, 403],
    ['DELETE', () => `/messages/${messageId}`, undefined, 403],
    ['GET', () => `/dm/${dmId}/messages`, undefined, 403],
    ['POST', () => `/dm/${dmId}/messages`, { content: 'Forbidden' }, 403],
    ['PATCH', () => `/dm/messages/${dmMessageId}`, { content: 'Stolen' }, 403],
    ['DELETE', () => `/dm/messages/${dmMessageId}`, undefined, 403],
    ['PUT', () => `/messages/${dmMessageId}/reactions/${encodeURIComponent('👍')}`, undefined, 404],
    ['PATCH', () => `/bots/${botId}`, { displayName: 'Stolen' }, 404],
    ['POST', () => `/bots/${botId}/tokens`, { name: 'Stolen' }, 404],
    ['DELETE', () => `/bots/${botId}`, undefined, 404],
    ['POST', () => '/livekit/token', () => ({ channelId }), 403],
  ])('%s rejects a foreign native target %# without changing retained rows', async (method, route, payload, status) => {
    const before = nativeRows(), body = typeof payload === 'function' ? payload() : payload;
    const response = await request(method, route(), outsider.token, body); expect(response.status).toBe(status);
    await response.body?.cancel(); expect(nativeRows()).toEqual(before);
  });
  it('keeps REST/WS private-message, reaction and voice authorization equivalent despite actor spoofing', async () => {
    const socket = await connectWs(instance.origin, outsider.token); sockets.push(socket);
    for (const event of [
      { type: 'message_create', channelId, content: 'Forbidden WS space' },
      { type: 'dm_message_create', dmChannelId: dmId, content: 'Forbidden WS DM' },
      { type: 'reaction_add', messageId: dmMessageId, emoji: '👍' },
      { type: 'voice_join', channelId },
    ]) {
      socket.events.length = 0; const before = nativeRows(); socket.send({ ...event, userId: owner.id, homeUserId: owner.id, homeInstance: instance.origin });
      socket.send({ type: 'ping' }); await socket.waitForEvent('pong');
      expect(socket.events.some(received => ['message_created', 'dm_message_created', 'reaction_added', 'voice_joined'].includes(received.type))).toBe(false);
      expect(nativeRows()).toEqual(before);
    }
  });
  it('protects tus HEAD/GET/PATCH/DELETE ownership without modifying the upload or its metadata', async () => {
    const response = await fetch(`${instance.origin}/api/files/upload`, { method: 'POST', headers: { authorization: `Bearer ${owner.token}`,
      'tus-resumable': '1.0.0', 'upload-length': '100', 'upload-metadata': `filename ${Buffer.from('private.png').toString('base64')}` } });
    expect(response.status).toBe(201); const target = new URL(response.headers.get('location')!, instance.origin); await response.body?.cancel();
    const disk = () => Object.fromEntries(fs.readdirSync(path.join(instance.storagePath, '.tus')).map(filename => [filename,
      crypto.hash('sha256', fs.readFileSync(path.join(instance.storagePath, '.tus', filename)))]));
    const before = disk(), rows = nativeRows();
    for (const method of ['HEAD', 'GET', 'PATCH', 'DELETE']) {
      const refused = await fetch(target, { method, headers: { authorization: `Bearer ${outsider.token}`, 'tus-resumable': '1.0.0',
        ...(method === 'PATCH' ? { 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' } : {}) }, ...(method === 'PATCH' ? { body: 'x' } : {}) });
      expect(refused.status).toBe(403); await refused.body?.cancel(); expect(disk()).toEqual(before); expect(nativeRows()).toEqual(rows);
    }
  });
  it('rejects a revoked native bot credential over REST and WS while another issued credential works', async () => {
    const issued = await success<{ id: string; token: string }>('POST', `/bots/${botId}/tokens`, owner.token, { name: 'Revoked audit token' });
    const retained = await success<{ token: string }>('POST', `/bots/${botId}/tokens`, owner.token, { name: 'Retained audit token' });
    await success('DELETE', `/bots/${botId}/tokens/${issued.id}`, owner.token);
    const response = await request('GET', '/users/@me', issued.token); expect(response.status).toBe(401); await response.body?.cancel();
    expect((await authAttempt(issued.token))[0]?.type).toBe('error');
    expect(await success('GET', '/users/@me', retained.token)).toMatchObject({ id: botId, isBot: true });
  });
  it('password change revokes existing REST sessions and disconnects their already-authenticated socket', async () => {
    const account = await registerLocal(instance, 'security_password');
    const ws = new WebSocket(`${instance.origin.replace('http:', 'ws:')}/ws`);
    try {
      await new Promise<void>((resolve, reject) => { ws.once('error', reject); ws.once('open', () => ws.send(JSON.stringify({ type: 'auth', token: account.token })));
        ws.on('message', bytes => { if ((JSON.parse(String(bytes)) as { type: string }).type === 'ready') resolve(); }); });
      const changed = await success<{ token: string }>('POST', '/users/@me/change-password', account.token, { currentPassword: account.password, newPassword: 'synthetic-replacement-password' });
      expect(await success('GET', '/users/@me', changed.token)).toMatchObject({ id: account.id });
      const response = await request('GET', '/users/@me', account.token); expect(response.status).toBe(401); await response.body?.cancel();
      await expect.poll(() => ws.readyState).toBe(WebSocket.CLOSED);
      expect((await authAttempt(account.token))[0]?.type).toBe('error');
    } finally { ws.close(); }
  });
  it('deleted accounts lose both REST and WS authority without deleting unrelated native history', async () => {
    const account = await registerLocal(instance, 'security_deleted');
    await success('DELETE', '/users/@me', account.token, { username: account.username, password: account.password });
    const before = nativeRows(); const response = await request('GET', '/users/@me', account.token); expect(response.status).toBe(401); await response.body?.cancel();
    expect((await authAttempt(account.token))[0]?.type).toBe('error'); expect(nativeRows()).toEqual(before);
  });
});
