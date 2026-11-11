import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Activity } from '@veyvox/shared';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';
import { applyChosenStatus, exchangeFriendPresence, publishActivities, applyStoredBotActivity } from './presence.js';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
const online = new Set<string>(), activities = new Map<string, Activity[]>();
const { sendToUser, setUserStatus } = vi.hoisted(() => ({ sendToUser: vi.fn(), setUserStatus: vi.fn() }));
vi.mock('../db/index.js', () => ({ getDb: () => db, getRawDb: () => sqlite, schema }));
vi.mock('./handler.js', () => ({ connectionManager: {
  isUserOnline: (id: string) => online.has(id), sendToUser, setUserStatus,
  getUserStatus: () => 'dnd', getUserShowActivity: () => true,
  getUserActivities: (id: string) => activities.get(id) ?? [],
  setUserActivities: (id: string, value: Activity[]) => activities.set(id, value),
} }));
beforeEach(() => {
  sqlite = new Database(':memory:'); buildNativeDatabase(sqlite); db = drizzle(sqlite, { schema });
  seedNativeUser(sqlite, 'native'); seedNativeUser(sqlite, 'friend');
  sqlite.exec("INSERT INTO friends VALUES ('native','friend',1)");
  online.clear(); activities.clear(); vi.clearAllMocks();
});
afterEach(() => { sqlite.close(); vi.restoreAllMocks(); });
describe('native connection-owned presence and activity', () => {
  it('stores the local choice while offline without publishing fake online presence', () => {
    applyChosenStatus('native', 'dnd');
    expect(sqlite.prepare("SELECT status,chosen_status FROM users WHERE id='native'").get()).toEqual({ status: 'offline', chosen_status: 'dnd' });
    expect(sendToUser).not.toHaveBeenCalled();
  });
  it('updates connected live and chosen state, notifying self/friends with local ids and no provenance', () => {
    online.add('native'); const fetch = vi.spyOn(globalThis, 'fetch'); applyChosenStatus('native', 'idle');
    expect(sqlite.prepare("SELECT status,chosen_status FROM users WHERE id='native'").get()).toEqual({ status: 'idle', chosen_status: 'idle' });
    expect(setUserStatus).toHaveBeenCalledWith('native', 'idle');
    for (const recipient of ['native', 'friend']) expect(sendToUser).toHaveBeenCalledWith(recipient, { type: 'presence_update', userId: 'native', status: 'idle' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('exchanges current local status and activity snapshots immediately after friendship, with offline activities cleared', () => {
    sqlite.exec("UPDATE users SET status='dnd',custom_status='native custom' WHERE id='native'");
    activities.set('friend', [{ type: 'playing', name: 'Must not appear while offline' }]);
    exchangeFriendPresence('native', 'friend');
    expect(sendToUser).toHaveBeenCalledWith('friend', { type: 'presence_update', userId: 'native', status: 'dnd', activities: [{ type: 'custom', name: 'native custom' }] });
    expect(sendToUser).toHaveBeenCalledWith('native', { type: 'presence_update', userId: 'friend', status: 'offline', activities: [] });
  });
  it('publishes and clears native activities without contacting another server', () => {
    const value: Activity[] = [{ type: 'playing', name: 'Chess' }], fetch = vi.spyOn(globalThis, 'fetch');
    publishActivities('native', value); expect(activities.get('native')).toEqual(value);
    expect(sendToUser).toHaveBeenCalledWith('friend', { type: 'presence_update', userId: 'native', status: 'dnd', activities: value });
    online.add('native'); applyStoredBotActivity('native', null);
    expect(activities.get('native')).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  });
});
