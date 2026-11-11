import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { WebSocket } from 'ws';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';
import { connectionManager } from './handler.js';
import { handleDmCallStartForTest as start, handleDmCallAcceptForTest as accept, handleClientEvent } from './events.js';
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
vi.mock('../db/index.js', () => ({ getDb: () => db, getRawDb: () => sqlite, schema }));
const sockets = new Map<string, WebSocket>();
function ws(id: string): WebSocket { return sockets.get(id)!; }
function received(id: string, type: string): Record<string, unknown>[] {
  return vi.mocked(ws(id).send).mock.calls.map(([raw]) => JSON.parse(String(raw)) as Record<string, unknown>).filter(event => event.type === type);
}
beforeEach(() => {
  vi.useFakeTimers(); sqlite = new Database(':memory:'); buildNativeDatabase(sqlite); db = drizzle(sqlite, { schema });
  for (const id of ['alice', 'bob', 'carol']) {
    seedNativeUser(sqlite, id); const socket = { readyState: 1, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
    sockets.set(id, socket); connectionManager.addConnection(id, socket);
  }
  sqlite.exec("INSERT INTO dm_channels (id,owner_id,created_at) VALUES ('group','alice',1),('other','alice',1); INSERT INTO dm_members (dm_channel_id,user_id) VALUES ('group','alice'),('group','bob'),('group','carol'),('other','alice'),('other','bob'); INSERT INTO spaces (id,name,owner_id,created_at) VALUES ('space','Space','bob',1); INSERT INTO space_members (space_id,user_id,joined_at) VALUES ('space','bob',1); INSERT INTO channels (id,space_id,name,type,created_at) VALUES ('voice','space','Voice','voice',1)");
});
afterEach(() => {
  for (const room of ['group', 'other', 'voice']) connectionManager.destroyRoom(room);
  for (const [id, socket] of sockets) { connectionManager.clearVoiceWs(id); connectionManager.removeConnection(socket); }
  sockets.clear(); vi.clearAllTimers(); vi.useRealTimers(); sqlite.close(); vi.restoreAllMocks();
});
describe('native call followups and one-room ownership', () => {
  it('ends the old ringing call when its caller starts another call', async () => {
    await start({ dmChannelId: 'group' }, 'alice', 'alice', ws('alice'));
    await start({ dmChannelId: 'other' }, 'alice', 'alice', ws('alice'));
    expect(connectionManager.getRoom('group')).toBeUndefined();
    expect(received('carol', 'dm_call_ended')).toEqual([{ type: 'dm_call_ended', dmChannelId: 'group' }]);
    expect(connectionManager.getVoiceWs('alice')).toBe(ws('alice'));
    expect(connectionManager.getRoom('other')?.metadata).toMatchObject({ state: 'ringing' });
  });
  it('ends the old ringing call on voice_join without losing the new voice binding', async () => {
    await start({ dmChannelId: 'group' }, 'bob', 'bob', ws('bob'));
    handleClientEvent({ type: 'voice_join', channelId: 'voice' }, 'bob', 'bob', ws('bob'));
    expect(connectionManager.getRoom('group')).toBeUndefined();
    expect(received('alice', 'dm_call_ended')).toHaveLength(1);
    expect(connectionManager.getUserRoom('bob')?.roomId).toBe('voice'); expect(connectionManager.getVoiceWs('bob')).toBe(ws('bob'));
  });
  it('names exactly the authenticated answerer by local id, on every native session, without HTTP', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch'); await start({ dmChannelId: 'group' }, 'alice', 'alice', ws('alice'));
    await accept({ dmChannelId: 'group', answeredByUserId: 'carol', answeredBy: { homeUserId: 'carol', homeInstance: 'https://unused.invalid' } }, 'bob', ws('bob'));
    for (const id of ['alice', 'bob', 'carol']) expect(received(id, 'dm_call_accepted')).toEqual([{ type: 'dm_call_accepted', dmChannelId: 'group', answeredByUserId: 'bob' }]);
    expect([...connectionManager.getRoomParticipants('group')].sort()).toEqual(['alice', 'bob']); expect(fetch).not.toHaveBeenCalled();
  });
  it('takes a member out of their previous call before accepting a different call', async () => {
    await start({ dmChannelId: 'group' }, 'alice', 'alice', ws('alice')); await accept({ dmChannelId: 'group' }, 'bob', ws('bob'));
    await start({ dmChannelId: 'other' }, 'alice', 'alice', ws('alice')); await accept({ dmChannelId: 'other' }, 'bob', ws('bob'));
    expect(connectionManager.getRoom('group')).toBeUndefined();
    expect([...connectionManager.getRoomParticipants('other')].sort()).toEqual(['alice', 'bob']); expect(connectionManager.getVoiceWs('bob')).toBe(ws('bob'));
    expect(received('carol', 'dm_call_ended')).toHaveLength(1);
  });
});
