import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { WebSocket } from 'ws';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';
import { connectionManager, buildReadyPayload } from './handler.js';
import {
  handleDmCallStartForTest as start, handleDmCallAcceptForTest as accept,
  handleDmCallRejectForTest as reject, handleDmCallEndForTest as end,
} from './events.js';

let testDb: ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));
const GROUP = 'dm-group', ONE_ON_ONE = 'dm-pair';
interface Sent { type: string; [key: string]: unknown }
const sockets = new Map<string, WebSocket[]>();
function connect(userId: string): WebSocket {
  const socket = { readyState: 1, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
  connectionManager.addConnection(userId, socket);
  sockets.set(userId, [...(sockets.get(userId) ?? []), socket]); return socket;
}
function ws(userId: string): WebSocket { return sockets.get(userId)![0]!; }
function sentOn(socket: WebSocket): Sent[] { return vi.mocked(socket.send).mock.calls.map(([raw]) => JSON.parse(String(raw)) as Sent); }
function received(userId: string, type: string): Sent[] { return (sockets.get(userId) ?? []).flatMap(sentOn).filter(event => event.type === type); }
function clearReceived(): void { for (const list of sockets.values()) for (const socket of list) vi.mocked(socket.send).mockClear(); }
function participants(id: string): string[] { return [...connectionManager.getRoomParticipants(id)].sort(); }
beforeEach(() => {
  vi.useFakeTimers(); sqlite = new Database(':memory:'); buildNativeDatabase(sqlite); testDb = drizzle(sqlite, { schema });
  for (const id of ['alice', 'bob', 'carol']) { seedNativeUser(sqlite, id); connect(id); }
  sqlite.exec("INSERT INTO dm_channels (id,owner_id,created_at) VALUES ('dm-group','alice',1),('dm-pair',NULL,1); INSERT INTO dm_members (dm_channel_id,user_id) VALUES ('dm-group','alice'),('dm-group','bob'),('dm-group','carol'),('dm-pair','alice'),('dm-pair','bob')");
});
afterEach(() => {
  for (const id of [GROUP, ONE_ON_ONE]) connectionManager.destroyRoom(id);
  for (const [id, list] of sockets) { connectionManager.clearVoiceWs(id); for (const socket of list) connectionManager.removeConnection(socket); }
  sockets.clear(); vi.clearAllTimers(); vi.useRealTimers(); sqlite.close(); vi.restoreAllMocks();
});

describe('starting a call in a DM that already has one', () => {
  it('joins a running group call instead of starting a second one', async () => {
    await start({ dmChannelId: GROUP }, 'alice', 'alice', ws('alice')); await accept({ dmChannelId: GROUP }, 'bob', ws('bob')); clearReceived();
    await start({ dmChannelId: GROUP }, 'carol', 'carol', ws('carol'));
    expect(participants(GROUP)).toEqual(['alice', 'bob', 'carol']); expect(received('carol', 'error')).toEqual([]);
    expect(received('carol', 'dm_call_accepted')).toHaveLength(1); expect(received('bob', 'dm_call_incoming')).toEqual([]);
  });
  it('joins a ringing call, which turns it active with the caller seated', async () => {
    await start({ dmChannelId: GROUP }, 'alice', 'alice', ws('alice')); await start({ dmChannelId: GROUP }, 'carol', 'carol', ws('carol'));
    expect(connectionManager.getRoom(GROUP)?.metadata).toMatchObject({ state: 'active', callerId: 'alice' }); expect(participants(GROUP)).toEqual(['alice', 'carol']);
  });
  it('refuses an already calling member on the sending socket only', async () => {
    await start({ dmChannelId: GROUP }, 'alice', 'alice', ws('alice')); const tab = connect('alice'); clearReceived();
    await start({ dmChannelId: GROUP }, 'alice', 'alice', tab);
    expect(sentOn(tab)).toEqual([expect.objectContaining({ type: 'error', code: 'dm_call_in_progress', dmChannelId: GROUP })]);
    expect(sentOn(ws('alice'))).toEqual([]); expect(connectionManager.getRoom(GROUP)?.metadata).toMatchObject({ state: 'ringing', callerId: 'alice' });
  });
  it('refuses a start from a nonmember without creating a room', async () => {
    const before = sqlite.serialize(); await start({ dmChannelId: ONE_ON_ONE }, 'carol', 'carol', ws('carol'));
    expect(received('carol', 'error')).toEqual([expect.objectContaining({ code: 'not_dm_member', dmChannelId: ONE_ON_ONE })]);
    expect(connectionManager.getRoom(ONE_ON_ONE)).toBeUndefined(); expect(sqlite.serialize()).toEqual(before);
  });
});
describe('native group call: end and decline', () => {
  it('ignores a cancel from a member not in the call', async () => {
    await start({ dmChannelId: GROUP }, 'alice', 'alice', ws('alice')); await accept({ dmChannelId: GROUP }, 'bob', ws('bob')); clearReceived();
    await end({ dmChannelId: GROUP }, 'carol');
    expect(participants(GROUP)).toEqual(['alice', 'bob']); expect(received('alice', 'dm_call_ended')).toEqual([]); expect(received('bob', 'dm_call_ended')).toEqual([]);
  });
  it('takes only the member who hangs up out of a call of three', async () => {
    await start({ dmChannelId: GROUP }, 'alice', 'alice', ws('alice')); await accept({ dmChannelId: GROUP }, 'bob', ws('bob')); await accept({ dmChannelId: GROUP }, 'carol', ws('carol')); clearReceived();
    await end({ dmChannelId: GROUP }, 'bob'); expect(participants(GROUP)).toEqual(['alice', 'carol']);
    expect(received('alice', 'voice_state_update')).toEqual([expect.objectContaining({ channelId: GROUP, userId: 'bob', action: 'leave' })]);
    expect(received('alice', 'dm_call_ended')).toEqual([]); expect(received('carol', 'dm_call_ended')).toEqual([]);
  });
  it('stops only the decliner ringing while the call rings', async () => {
    await start({ dmChannelId: GROUP }, 'alice', 'alice', ws('alice')); clearReceived(); await reject({ dmChannelId: GROUP }, 'bob');
    expect(connectionManager.getRoom(GROUP)?.metadata).toMatchObject({ state: 'ringing' });
    expect(received('bob', 'dm_call_rejected')).toHaveLength(1); expect(received('alice', 'dm_call_rejected')).toEqual([]); expect(received('carol', 'dm_call_rejected')).toEqual([]);
    await accept({ dmChannelId: GROUP }, 'carol', ws('carol')); expect(participants(GROUP)).toEqual(['alice', 'carol']);
  });
  it('stops only the decliner ringing once others have joined', async () => {
    await start({ dmChannelId: GROUP }, 'alice', 'alice', ws('alice')); await accept({ dmChannelId: GROUP }, 'bob', ws('bob')); clearReceived(); await reject({ dmChannelId: GROUP }, 'carol');
    expect(participants(GROUP)).toEqual(['alice', 'bob']); expect(received('carol', 'dm_call_rejected')).toHaveLength(1);
    expect(received('alice', 'dm_call_rejected')).toEqual([]); expect(received('bob', 'dm_call_rejected')).toEqual([]);
  });
  it('ignores a decline from a participant', async () => {
    await start({ dmChannelId: GROUP }, 'alice', 'alice', ws('alice')); await accept({ dmChannelId: GROUP }, 'bob', ws('bob')); clearReceived(); await reject({ dmChannelId: GROUP }, 'bob');
    expect(participants(GROUP)).toEqual(['alice', 'bob']); expect(received('bob', 'dm_call_rejected')).toEqual([]);
  });
  it('ends as rejected once every ringee declines', async () => {
    await start({ dmChannelId: GROUP }, 'alice', 'alice', ws('alice')); await reject({ dmChannelId: GROUP }, 'bob'); clearReceived(); await reject({ dmChannelId: GROUP }, 'carol');
    expect(connectionManager.getRoom(GROUP)).toBeUndefined(); for (const id of ['alice', 'bob', 'carol']) expect(received(id, 'dm_call_rejected')).toHaveLength(1);
  });
  it('ends when its last participant leaves', async () => {
    await start({ dmChannelId: GROUP }, 'alice', 'alice', ws('alice')); await accept({ dmChannelId: GROUP }, 'bob', ws('bob')); await end({ dmChannelId: GROUP }, 'alice');
    expect(participants(GROUP)).toEqual(['bob']); clearReceived(); await end({ dmChannelId: GROUP }, 'bob');
    expect(connectionManager.getRoom(GROUP)).toBeUndefined(); for (const id of ['alice', 'bob', 'carol']) expect(received(id, 'dm_call_ended')).toHaveLength(1);
  });
  it('ends an unanswered call when the caller cancels', async () => {
    await start({ dmChannelId: GROUP }, 'alice', 'alice', ws('alice')); clearReceived(); await end({ dmChannelId: GROUP }, 'alice');
    expect(connectionManager.getRoom(GROUP)).toBeUndefined(); expect(received('bob', 'dm_call_ended')).toHaveLength(1); expect(received('carol', 'dm_call_ended')).toHaveLength(1);
  });
  it('ends an unanswered call at the ring timeout', async () => {
    await start({ dmChannelId: GROUP }, 'alice', 'alice', ws('alice')); await reject({ dmChannelId: GROUP }, 'bob'); clearReceived(); vi.advanceTimersByTime(60_000);
    expect(connectionManager.getRoom(GROUP)).toBeUndefined(); expect(received('carol', 'dm_call_ended')).toHaveLength(1);
  });
});
describe('native 1-on-1 semantics', () => {
  it('ends for both when one hangs up', async () => {
    await start({ dmChannelId: ONE_ON_ONE }, 'alice', 'alice', ws('alice')); await accept({ dmChannelId: ONE_ON_ONE }, 'bob', ws('bob')); clearReceived(); await end({ dmChannelId: ONE_ON_ONE }, 'bob');
    expect(connectionManager.getRoom(ONE_ON_ONE)).toBeUndefined(); expect(received('alice', 'dm_call_ended')).toHaveLength(1); expect(received('bob', 'dm_call_ended')).toHaveLength(1);
  });
  it('ends for both when the callee declines', async () => {
    await start({ dmChannelId: ONE_ON_ONE }, 'alice', 'alice', ws('alice')); clearReceived(); await reject({ dmChannelId: ONE_ON_ONE }, 'bob');
    expect(connectionManager.getRoom(ONE_ON_ONE)).toBeUndefined(); expect(received('alice', 'dm_call_rejected')).toHaveLength(1); expect(received('bob', 'dm_call_rejected')).toHaveLength(1);
  });
  it('joins when the callee presses call while ringing', async () => {
    await start({ dmChannelId: ONE_ON_ONE }, 'alice', 'alice', ws('alice')); await start({ dmChannelId: ONE_ON_ONE }, 'bob', 'bob', ws('bob'));
    expect(participants(ONE_ON_ONE)).toEqual(['alice', 'bob']); expect(received('bob', 'error')).toEqual([]);
  });
});
describe('ready and coded refusals', () => {
  it('does not re-ring a declined group member on ready', async () => {
    await start({ dmChannelId: GROUP }, 'alice', 'alice', ws('alice')); await reject({ dmChannelId: GROUP }, 'bob');
    expect(buildReadyPayload('bob').activeCalls.map(call => call.dmChannelId)).not.toContain(GROUP); expect(buildReadyPayload('carol').activeCalls.map(call => call.dmChannelId)).toContain(GROUP);
  });
  it('names the missing call on only the sending socket', async () => {
    const tab = connect('bob'); await accept({ dmChannelId: GROUP }, 'bob', tab);
    expect(sentOn(tab)).toEqual([expect.objectContaining({ type: 'error', code: 'dm_call_not_found', dmChannelId: GROUP })]); expect(sentOn(ws('bob'))).toEqual([]);
  });
  it('refuses acceptance by a nonmember', async () => {
    await accept({ dmChannelId: ONE_ON_ONE }, 'carol', ws('carol'));
    expect(received('carol', 'error')).toEqual([expect.objectContaining({ code: 'not_dm_member', dmChannelId: ONE_ON_ONE })]);
  });
  it('retired call identifiers cannot resolve a room or invoke HTTP on any followup', async () => {
    await start({ dmChannelId: GROUP }, 'alice', 'alice', ws('alice')); const before = sqlite.serialize(); const fetch = vi.spyOn(globalThis, 'fetch'); clearReceived();
    await accept({ federatedCallId: GROUP }, 'bob', ws('bob')); await reject({ federatedCallId: GROUP }, 'bob'); await end({ federatedCallId: GROUP }, 'alice');
    expect(connectionManager.getRoom(GROUP)?.metadata).toMatchObject({ state: 'ringing' }); expect(sqlite.serialize()).toEqual(before);
    expect(received('bob', 'error')).toEqual([expect.objectContaining({ code: 'validation_failed' })]); expect(fetch).not.toHaveBeenCalled();
  });
});
