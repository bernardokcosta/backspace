import { describe, expect, it } from 'vitest';
import * as identity from './identity';
import { findLastOwnEditableMessage } from '../components/chat/messageEditing';
import type { MessageWithUser } from '@veyvox/shared';
describe('native names and author comparisons', () => {
  it('retains the entire sovereign username, including @, without URL or suffix inference', () => {
    expect(identity.userDisplayName({ username: 'legacy@old.invalid', displayName: null })).toBe('legacy@old.invalid');
    expect(identity.spaceMemberName({ nickname: 'Space nick' }, { username: 'legacy@old.invalid' })).toBe('Space nick');
    expect(identity.userDisplayName({ username: 'legacy@old.invalid', displayName: 'Display' })).toBe('Display');
    for (const field of ['parseFederatedUsername', 'homeIdentityOf', 'userKey', 'isMine', 'isIssuedByHome', 'personRequest', 'ownRowAt', 'isFederationGlobeApplicable', 'selfIdentityOf']) expect(identity).not.toHaveProperty(field);
  });
  it('edits only the native author, and waits rather than choosing an older confirmed send', () => {
    const msg = (id: string, userId: string) => ({ id, userId, user: { id: userId }, content: 'text' }) as MessageWithUser;
    expect(findLastOwnEditableMessage([msg('1', 'me'), msg('2', 'other')], 'me')?.id).toBe('1');
    expect(findLastOwnEditableMessage([msg('1', 'me'), msg('temp_2', 'me')], 'me')).toBeNull();
    expect(findLastOwnEditableMessage([msg('1', 'me')], null)).toBeNull();
  });
});
