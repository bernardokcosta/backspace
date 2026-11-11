import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Friend } from '@veyvox/shared';
import { HttpError } from '../api/client';
import i18n from '../i18n';
import { sendSpaceInvite, spaceInviteFailureReason } from './spaceInvite';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
const send = vi.hoisted(() => vi.fn());
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), api: { dm: { spaceInvite: send } } }));
const friend = { id: 'native', username: 'native@retained.test' } as Friend;
const source = { spaceId: 'space', inviteCode: 'code' };
const t = i18n.getFixedT(null, ['spaces', 'common']);
beforeEach(() => { send.mockReset().mockResolvedValue({}); });
describe('shared native space invitation sender', () => {
  it('sends only native target and source IDs through the primary API', async () => {
    expect(await sendSpaceInvite(friend, source, t)).toEqual({ kind: 'success' });
    expect(send).toHaveBeenCalledExactlyOnceWith({ target: { userId: friend.id }, spaceId: source.spaceId, inviteCode: source.inviteCode, spaceInstanceOrigin: '' });
  });
  it('keeps localized failure reasons and never retries rejected sends automatically', async () => {
    send.mockRejectedValueOnce(new HttpError(400, 'Not a friend', undefined, 'not_a_friend'));
    expect(await sendSpaceInvite(friend, source, t)).toEqual({ kind: 'failure', reason: t('spaces:invite.failure.notAFriend') });
    expect(send).toHaveBeenCalledOnce();
    expect(spaceInviteFailureReason(new Error('Failed to fetch'), t)).toBe(t('spaces:invite.failure.unreachable'));
  });
});
