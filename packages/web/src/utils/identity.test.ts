import { describe, expect, it } from 'vitest';
import { spaceMemberName, userDisplayName } from './identity';
describe('native account display names', () => {
  it('prefers a nonempty display name to the complete username', () => {
    expect(userDisplayName({ username: 'kai@retained.test', displayName: 'Kai' })).toBe('Kai');
  });
  it.each([null, '', undefined])('keeps the entire retained username with displayName=%s', displayName => {
    expect(userDisplayName({ username: 'kai@retained.test', displayName })).toBe('kai@retained.test');
    expect(userDisplayName({ username: 'kai', displayName })).toBe('kai');
  });
  it('prefers a space nickname only in its member context', () => {
    const user = { displayName: null, username: 'kai@retained.test' };
    expect(spaceMemberName({ nickname: 'Pilot' }, user)).toBe('Pilot');
    expect(spaceMemberName({ nickname: null }, user)).toBe(user.username);
    expect(spaceMemberName(null, { displayName: 'Kai', username: 'kai' })).toBe('Kai');
  });
});
