import { describe, expect, it } from 'vitest';
import { sanitizeUser } from './sanitize.js';
import type { schema } from '../db/index.js';

describe('native public and self profile projection', () => {
  const row: typeof schema.users.$inferSelect = {
    id: 'native', username: 'member', displayName: 'Member', passwordHash: 'synthetic-private-hash', avatar: null,
    status: 'offline', chosenStatus: 'dnd', customStatus: null, isAdmin: 0, createdAt: 1,
    banner: null, accentColor: null, avatarColor: 'mint', bio: 'native bio', profileUpdatedAt: 2, passwordChangedAt: 3,
    isDeleted: 0, isBot: 0, developerMode: 1, botOwnerId: null, botActivity: null, botRequestedPermissions: null,
    discoverable: 1, showActivity: 1,
  };
  it('never serializes credentials, chosen-status storage, bot internals or private self preferences to another user', () => {
    const profile = sanitizeUser(row);
    expect(profile).toMatchObject({ id: 'native', username: 'member', bio: 'native bio' });
    for (const field of ['passwordHash', 'passwordChangedAt', 'chosenStatus', 'botOwnerId', 'botActivity', 'lastClient', 'showActivity', 'developerMode', 'homeUserId', 'homeInstance', 'replicatedInstances']) expect(profile).not.toHaveProperty(field);
    expect(sanitizeUser(row, true)).toMatchObject({ showActivity: true, developerMode: true });
  });
  it('never exposes an internal deleted-user marker or old profile bytes', () => {
    const profile = sanitizeUser({ ...row, username: '!deleted:native', isDeleted: 1 }, true);
    expect(profile).toMatchObject({ id: 'native', username: 'Deleted User', displayName: null, bio: null, isDeleted: true, status: 'offline', showActivity: false, developerMode: false });
    expect(JSON.stringify(profile)).not.toContain('!deleted'); expect(JSON.stringify(profile)).not.toContain('synthetic-private');
  });
});
