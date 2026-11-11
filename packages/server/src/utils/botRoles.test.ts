import { describe, expect, it } from 'vitest';
import { managedRoleBaseName } from './botRoles.js';

describe('native managed bot role names', () => {
  it('uses the display name or exact stored handle without interpreting @', () => {
    expect(managedRoleBaseName({ displayName: '  Music  ', username: 'old@name' })).toBe('Music');
    expect(managedRoleBaseName({ displayName: null, username: 'old@name' })).toBe('old@name');
    expect(managedRoleBaseName({ displayName: '', username: '@legacy@name' })).toBe('@legacy@name');
    expect(managedRoleBaseName({ displayName: null, username: 'native_bot' })).toBe('native_bot');
  });
});
