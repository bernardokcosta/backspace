import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertDmMember, reopenClosedDmMembers, setDmMemberClosed } from './dmMemberClosed.js';
let db: Database.Database;
beforeEach(() => { db = new Database(':memory:'); db.exec('CREATE TABLE dm_members (dm_channel_id text, user_id text, closed integer DEFAULT 0, PRIMARY KEY(dm_channel_id,user_id))'); });
afterEach(() => db.close());
describe('native closed DM membership without replicated clocks', () => {
  it('inserts native open and closed memberships without a retired timestamp', () => {
    insertDmMember(db, 'dm', 'open'); insertDmMember(db, 'dm', 'closed', { closed: true });
    expect(db.prepare('SELECT user_id,closed FROM dm_members ORDER BY user_id').all()).toEqual([{ user_id: 'closed', closed: 1 }, { user_id: 'open', closed: 0 }]);
  });
  it('changes only the named native membership and reports real state changes', () => {
    insertDmMember(db, 'dm', 'native'); expect(setDmMemberClosed(db, 'dm', 'native', true)).toBe(true);
    expect(setDmMemberClosed(db, 'dm', 'native', true)).toBe(false); expect(setDmMemberClosed(db, 'dm', 'other', false)).toBe(false);
    expect(setDmMemberClosed(db, 'dm', 'native', false)).toBe(true);
  });
  it('reopens closed memberships only in the active native conversation', () => {
    for (const channel of ['dm', 'other']) insertDmMember(db, channel, 'native', { closed: true });
    expect(reopenClosedDmMembers(db, 'dm')).toEqual(['native']); expect(reopenClosedDmMembers(db, 'dm')).toEqual([]);
    expect(db.prepare("SELECT closed FROM dm_members WHERE dm_channel_id='other'").get()).toEqual({ closed: 1 });
  });
});
