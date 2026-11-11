import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { WebSocket } from 'ws';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';
import { connectionManager, buildReadyPayload, VOICE_RECONNECT_GRACE_MS } from './handler.js';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
const sockets = new Map<string, WebSocket>();
vi.mock('../db/index.js', () => ({ getDb: () => db, getRawDb: () => sqlite, schema }));
vi.mock('./events.js', () => ({ handleClientEvent: vi.fn() }));
function connect(id: string): WebSocket {
  const ws = { readyState: 1, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
  sockets.set(id, ws); connectionManager.addConnection(id, ws); return ws;
}
beforeEach(() => {
  vi.useFakeTimers(); sqlite = new Database(':memory:'); buildNativeDatabase(sqlite); db = drizzle(sqlite, { schema });
  for (const id of ['alice', 'bob', 'carol']) seedNativeUser(sqlite, id);
  sqlite.exec("INSERT INTO dm_channels (id,owner_id,created_at) VALUES ('group','alice',1),('pair',NULL,1); INSERT INTO dm_members (dm_channel_id,user_id) VALUES ('group','alice'),('group','bob'),('group','carol'),('pair','alice'),('pair','bob')");
  for (const id of ['alice', 'bob', 'carol']) connect(id);
});
afterEach(() => {
  for (const id of ['group', 'pair']) connectionManager.destroyRoom(id);
  for (const [id, ws] of sockets) { connectionManager.clearVoiceWs(id); connectionManager.removeConnection(ws); }
  sockets.clear(); vi.clearAllTimers(); vi.useRealTimers(); sqlite.close(); vi.restoreAllMocks();
});
function participants(channel = 'group'): string[] { return [...connectionManager.getRoomParticipants(channel)].sort(); }
describe('native ConnectionManager lifecycle without peer registries', () => {
  it('has no remote call registry, late binding or relay hook API', () => {
    for (const method of ['createFederatedCall', 'getFederatedCall', 'getAllFederatedCalls', 'lateBindFederatedCall', 'evictFederatedCallsForHost', 'leavePeerParticipants', 'setRingTimeoutFanoutHook', 'setFederatedCallLeaveHook']) expect(connectionManager).not.toHaveProperty(method);
  });
  it('classifies group calls by the local owner rather than a private pair key', () => {
    expect(connectionManager.createDmRoom('group', 'alice')).toBe(true);
    expect(connectionManager.createDmRoom('pair', 'alice')).toBe(true);
    expect(connectionManager.getRoom('group')?.metadata).toMatchObject({ group: true });
    expect(connectionManager.getRoom('pair')?.metadata).toMatchObject({ group: false });
    expect(connectionManager.getRoom('group')?.metadata).not.toHaveProperty('remoteParticipants');
  });
  it('keeps an active group call until its last native participant leaves', () => {
    connectionManager.createDmRoom('group', 'alice'); connectionManager.activateDmRoom('group');
    for (const id of ['alice', 'bob', 'carol']) connectionManager.joinRoom('group', id);
    expect(connectionManager.leaveGroupDmCall('group', 'bob')).toBe('left'); expect(participants()).toEqual(['alice', 'carol']);
    expect(connectionManager.leaveGroupDmCall('group', 'alice')).toBe('left');
    expect(connectionManager.leaveGroupDmCall('group', 'carol')).toBe('ended'); expect(connectionManager.getRoom('group')).toBeUndefined();
  });
  it('stops only a decliner\'s group ring and keeps them un-rung on ready until everyone declines', () => {
    connectionManager.createDmRoom('group', 'alice');
    expect(connectionManager.declineGroupDmCall('group', 'bob')).toBe('declined');
    expect(buildReadyPayload('bob').activeCalls).toEqual([]); expect(buildReadyPayload('carol').activeCalls).toHaveLength(1);
    expect(connectionManager.declineGroupDmCall('group', 'carol')).toBe('ended'); expect(connectionManager.getRoom('group')).toBeUndefined();
  });
  it('ends an unanswered native ring once at sixty seconds without outgoing HTTP', () => {
    const fetch = vi.spyOn(globalThis, 'fetch'); connectionManager.createDmRoom('pair', 'alice');
    vi.advanceTimersByTime(60_000); expect(connectionManager.getRoom('pair')).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    const sends = vi.mocked(sockets.get('bob')!.send).mock.calls.map(call => JSON.parse(String(call[0])) as { type: string });
    expect(sends.filter(event => event.type === 'dm_call_ended')).toHaveLength(1);
  });
  it('removes a native voice seat after reconnect grace, not on an unrelated tab disconnect', () => {
    connectionManager.createDmRoom('pair', 'alice'); connectionManager.activateDmRoom('pair');
    connectionManager.joinRoom('pair', 'alice'); connectionManager.joinRoom('pair', 'bob');
    connectionManager.setVoiceWs('alice', sockets.get('alice')!);
    const tab = { readyState: 1, send: vi.fn() } as unknown as WebSocket; connectionManager.addConnection('alice', tab); connectionManager.removeConnection(tab);
    vi.advanceTimersByTime(VOICE_RECONNECT_GRACE_MS); expect(participants('pair')).toEqual(['alice', 'bob']);
    connectionManager.removeConnection(sockets.get('alice')!); vi.advanceTimersByTime(VOICE_RECONNECT_GRACE_MS);
    expect(participants('pair')).toEqual(['bob']);
  });
  it('publishes the chosen local status and finally clears live presence without changing the choice', () => {
    sqlite.exec("UPDATE users SET chosen_status='dnd' WHERE id='alice'");
    expect(connectionManager.publishConnectStatus({ id: 'alice', chosenStatus: 'dnd' })).toBe('dnd');
    connectionManager.removeConnection(sockets.get('alice')!); vi.advanceTimersByTime(5000);
    expect(sqlite.prepare("SELECT status,chosen_status FROM users WHERE id='alice'").get()).toEqual({ status: 'offline', chosen_status: 'dnd' });
  });
});
