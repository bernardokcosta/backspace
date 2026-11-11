import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { spawnInstance, stopInstance, type SpawnedInstance } from './helpers/instanceHarness.js';
import { connectWs, type WsCapture } from './helpers/wsListener.js';

interface Account { id: string; username: string; token: string }
const password = 'synthetic-native-password';
const media = { url: 'wss://media.invalid/livekit', apiKey: 'synthetic-api-key', apiSecret: 'synthetic-secret-at-least-thirty-two-bytes' };
let instance: SpawnedInstance | undefined, directory: string;
const sockets: WsCapture[] = [];
async function call(method: string, route: string, token?: string, body?: unknown): Promise<Response> {
  return fetch(`${instance!.origin}/api${route}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function json<T>(method: string, route: string, token?: string, body?: unknown): Promise<T> {
  const response = await call(method, route, token, body); const result = await response.json();
  expect(response.status, JSON.stringify(result)).toBeLessThan(300); return result as T;
}
async function register(username: string): Promise<Account> {
  const result = await json<{ user: { id: string; username: string }; token: string }>('POST', '/auth/register', undefined, { username, password });
  return { ...result.user, token: result.token };
}
async function socketFor(account: Account): Promise<WsCapture> {
  const socket = await connectWs(instance!.origin, account.token); sockets.push(socket); return socket;
}
async function friend(sender: Account, recipient: Account): Promise<void> {
  const { requestId } = await json<{ requestId: string }>('POST', '/social/requests', sender.token, { username: recipient.username });
  await json('PATCH', `/social/requests/${requestId}`, recipient.token, { status: 'accepted' });
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'veyvox-standalone-native-')); const storagePath = path.join(directory, 'uploads'); await mkdir(storagePath);
  instance = await spawnInstance({ domain: 'native.invalid', dbPath: path.join(directory, 'db.sqlite'), storagePath, logPath: path.join(directory, 'server.log'), jwtSecret: crypto.randomBytes(32).toString('hex'), livekit: media });
}, 90_000);
afterAll(async () => {
  for (const socket of sockets) socket.close(); if (instance) await stopInstance(instance);
  if (directory) await rm(directory, { recursive: true, force: true });
});
describe('native REST + WebSocket integration', () => {
  it('preserves local account, private admission, social, DM history, reactions/read state, bot and call flows', async () => {
    const alice = await register('native_alice'), bob = await register('native_bob'), carol = await register('native_carol');
    const login = await json<{ user: { id: string }; token: string }>('POST', '/auth/login', undefined, { username: alice.username, password });
    expect(login.user.id).toBe(alice.id); expect((await call('POST', '/auth/login', undefined, { username: alice.username, password: 'wrong' })).status).toBe(401);
    const a = await socketFor(alice), b = await socketFor(bob), c = await socketFor(carol);
    expect((await a.waitForEvent('ready')).user).toMatchObject({ id: alice.id });

    const space = await json<{ id: string }>('POST', '/spaces', alice.token, { name: 'Native approval space', visibility: 'request' });
    const pending = await json<{ id: string; status: string }>('POST', `/spaces/${space.id}/request-join`, bob.token, {}); expect(pending.status).toBe('pending');
    expect((await call('PATCH', `/spaces/${space.id}/join-requests/${pending.id}`, carol.token, { action: 'accept' })).status).toBe(403);
    await json('PATCH', `/spaces/${space.id}/join-requests/${pending.id}`, alice.token, { action: 'accept' });
    expect(await b.waitForEvent('join_request_accepted')).toMatchObject({ space: { id: space.id } });
    expect((await json<Array<{ id: string }>>('GET', '/spaces', bob.token)).map(item => item.id)).toContain(space.id);
    expect((await json<Array<{ id: string }>>('GET', '/spaces', carol.token)).map(item => item.id)).not.toContain(space.id);

    await friend(alice, bob); await friend(alice, carol);
    expect((await json<Array<{ id: string }>>('GET', '/social/friends', bob.token)).map(user => user.id)).toEqual([alice.id]);
    const pair = await json<{ id: string }>('POST', '/dm', alice.token, { userId: bob.id });
    expect((await json<{ id: string }>('POST', '/dm', bob.token, { userId: alice.id })).id).toBe(pair.id);
    const group = await json<{ id: string }>('POST', '/dm/group', alice.token, { users: [{ id: bob.id }, { id: carol.id }], name: 'Native group' });
    a.send({ type: 'dm_message_create', dmChannelId: pair.id, content: 'Native private history' });
    const findCreated = () => b.events.find(event => event.type === 'dm_message_created' && (event.message as { content?: string })?.content === 'Native private history');
    await expect.poll(findCreated).toBeDefined();
    const message = findCreated()!.message as { id: string; userId: string; content: string };
    expect(message).toMatchObject({ userId: alice.id, content: 'Native private history' });
    const reply = await json<{ id: string; replyTo: { id: string } }>('POST', `/dm/${pair.id}/messages`, bob.token, { content: 'Native reply', replyToId: message.id }); expect(reply.replyTo.id).toBe(message.id);
    expect((await call('POST', `/dm/${group.id}/messages`, alice.token, { content: 'Confined reply', replyToId: message.id })).status).toBe(400);
    expect(await json('PUT', `/messages/${message.id}/reactions/${encodeURIComponent('👍')}`, bob.token)).toEqual({ success: true, changed: true });
    expect(await json('PUT', `/messages/${message.id}/reactions/${encodeURIComponent('👍')}`, bob.token)).toEqual({ success: true, changed: false });
    b.send({ type: 'channel_ack', channelId: pair.id, messageId: reply.id }); expect(await b.waitForEvent('channel_ack')).toMatchObject({ channelId: pair.id, messageId: reply.id });

    const bot = await json<{ bot: { id: string }; token: string }>('POST', '/bots', alice.token, { name: 'native_bot' });
    await json('POST', `/bots/${bot.bot.id}/spaces`, alice.token, { spaceId: space.id });
    expect(await json('GET', '/users/@me', bot.token)).toMatchObject({ id: bot.bot.id, isBot: true });
    expect((await call('PATCH', `/bots/${bot.bot.id}`, carol.token, { displayName: 'Not mine' })).status).toBe(404);

    // Local group call correlation and per-user credentials remain separate.
    b.events.length = 0; c.events.length = 0;
    a.send({ type: 'dm_call_start', dmChannelId: group.id }); expect(await b.waitForEvent('dm_call_incoming')).toMatchObject({ dmChannelId: group.id, callerId: alice.id });
    b.send({ type: 'dm_call_accept', dmChannelId: group.id, answeredByUserId: carol.id });
    expect(await c.waitForEvent('dm_call_accepted')).toEqual({ type: 'dm_call_accepted', dmChannelId: group.id, answeredByUserId: bob.id });
    const voice = await json<{ token: string; url: string }>('POST', '/livekit/token', bob.token, { dmChannelId: group.id });
    expect(voice.url).toBe(media.url); expect(jwt.verify(voice.token, media.apiSecret, { issuer: media.apiKey })).toMatchObject({ sub: `${bob.id}:${bob.username}`, video: { room: `dm-${group.id}`, roomJoin: true } });
    b.send({ type: 'dm_call_end', dmChannelId: group.id }); a.send({ type: 'dm_call_end', dmChannelId: group.id });
    expect(await c.waitForEvent('dm_call_ended')).toMatchObject({ dmChannelId: group.id });

    const db = new Database(instance!.dbPath, { readonly: true });
    try {
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.prepare('SELECT last_read_message_id FROM read_states WHERE user_id=? AND channel_id=?').get(bob.id, pair.id)).toEqual({ last_read_message_id: reply.id });
      expect(db.prepare('SELECT COUNT(*) AS count FROM dm_reactions WHERE dm_message_id=?').get(message.id)).toEqual({ count: 1 });
    } finally { db.close(); }
  }, 30_000);
});
