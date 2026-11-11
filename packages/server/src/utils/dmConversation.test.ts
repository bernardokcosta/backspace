import { describe, it, expect } from 'vitest';
import { isGroupConversation, mayBeOneOnOneRow, oneOnOneKey } from './dmConversation.js';

describe('oneOnOneKey', () => {
  it('keeps the original native pair vector in either order', () => {
    const expected = 'fc8aa3239ccea0cd4cbfb7701d770ac9';
    const alice = { id: 'alice-home' }, bob = { id: 'bob-remote' };
    expect(oneOnOneKey(alice, bob)).toBe(expected);
    expect(oneOnOneKey(bob, alice)).toBe(expected);
  });

  it('is 32 lowercase hex characters', () => {
    expect(oneOnOneKey({ id: 'a' }, { id: 'b' })).toMatch(/^[0-9a-f]{32}$/);
  });

  it('does not equate distinct native accounts', () => {
    expect(oneOnOneKey({ id: 'a' }, { id: 'b' })).not.toBe(oneOnOneKey({ id: 'a' }, { id: 'c' }));
  });
});

describe('native conversation type', () => {
  it('uses the stable owner, never a client-visible copy key', () => {
    expect(isGroupConversation({ owner_id: 'owner' })).toBe(true);
    expect(mayBeOneOnOneRow({ owner_id: 'owner' })).toBe(false);
    expect(isGroupConversation({ owner_id: null })).toBe(false);
    expect(mayBeOneOnOneRow({ owner_id: null })).toBe(true);
  });
});
