import { describe, expect, it } from 'vitest';
import { parseInviteInput, spaceInviteUrl } from './inviteParser';
describe('native space invite URL', () => {
  it('always uses the current server origin and native join route', () => {
    expect(spaceInviteUrl('a3f1b2c4')).toBe(`${window.location.origin}/join/a3f1b2c4`);
  });
  it('encodes the code as a single route segment, never a host or query', () => {
    const url = new URL(spaceInviteUrl('code/with?reserved#text'));
    expect(url.origin).toBe(window.location.origin); expect(url.pathname).toBe('/join/code%2Fwith%3Freserved%23text');
    expect(url.search).toBe(''); expect(url.hash).toBe('');
  });
  it('parses a generated native link back into its bare code', () => {
    expect(parseInviteInput(spaceInviteUrl('a3f1b2c4'))).toEqual({ code: 'a3f1b2c4' });
  });
});
