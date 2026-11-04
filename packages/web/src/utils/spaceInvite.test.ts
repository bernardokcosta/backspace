import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaggedFriend } from '../stores/socialStore';
import { HttpError } from '../api/client';
import i18n from '../i18n';
import { inviteTarget, sendSpaceInvite, spaceInviteFailureReason, spaceOriginFor } from './spaceInvite';

vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
const route = vi.hoisted(() => ({ home: '', origins: [] as string[], send: vi.fn() }));
vi.mock('../stores/instanceStore', () => ({ getFriendsHomeOrigin: () => route.home }));
vi.mock('./crossStoreResolvers', () => ({ getApiForOrigin: (origin: string) => {
  route.origins.push(origin); return { dm: { spaceInvite: route.send } };
} }));
const friend = (overrides: Partial<TaggedFriend> = {}): TaggedFriend => ({
  id: 'friend-row', username: 'alex', displayName: 'Alex', avatar: null, banner: null, accentColor: null,
  avatarColor: null, bio: null, status: 'online', customStatus: null, createdAt: 1, addedAt: 1,
  homeUserId: null, homeInstance: null, _instanceOrigin: '', ...overrides,
});
const t = i18n.getFixedT(null, ['spaces', 'common']);
beforeEach(() => { route.home = ''; route.origins.length = 0; route.send.mockReset(); route.send.mockResolvedValue({}); });

describe('shared space invitation sender', () => {
  it('names a native local friend by the receiving instance row', () => {
    expect(inviteTarget(friend(), '')).toEqual({ userId: 'friend-row' });
  });
  it('uses a federated home identity rather than a coinciding local row id', () => {
    expect(inviteTarget(friend({ homeUserId: 'real-home-id', homeInstance: 'friend.example' }), ''))
      .toEqual({ homeUserId: 'real-home-id', homeInstance: 'friend.example' });
  });
  it('refuses an unresolvable legacy stub without a request', async () => {
    const target = friend({ homeInstance: 'legacy.example', homeUserId: null, _instanceOrigin: 'https://other.example' });
    expect(inviteTarget(target, '')).toBeNull();
    expect(await sendSpaceInvite(target, { spaceId: 'space', instanceOrigin: '', inviteCode: 'code' }, t))
      .toMatchObject({ kind: 'failure' });
    expect(route.send).not.toHaveBeenCalled();
  });
  it.each([
    ['', '', ''],
    ['', 'https://home.example', window.location.origin],
    ['https://home.example', 'https://home.example', ''],
    ['https://third.example', 'https://home.example', 'https://third.example'],
  ])('translates source %s for receiver %s', (source, receiver, expected) => {
    expect(spaceOriginFor(source, receiver)).toBe(expected);
  });
  it('sends three-way invitations through the true home, not the viewed instance', async () => {
    route.home = 'https://home.example';
    const target = friend({ _instanceOrigin: 'https://friend.example' });
    expect(await sendSpaceInvite(target, { spaceId: 'space', instanceOrigin: 'https://third.example', inviteCode: 'code' }, t))
      .toEqual({ kind: 'success' });
    expect(route.origins).toEqual(['https://home.example']);
    expect(route.send).toHaveBeenCalledWith({ target: { homeUserId: 'friend-row', homeInstance: 'friend.example' },
      spaceId: 'space', spaceInstanceOrigin: 'https://third.example', inviteCode: 'code' });
  });
  it('keeps localized failure reasons and never retries a rejected send automatically', async () => {
    const error = new HttpError(400, 'Not a friend', undefined, 'not_a_friend');
    route.send.mockRejectedValueOnce(error);
    const result = await sendSpaceInvite(friend(), { spaceId: 'space', instanceOrigin: '', inviteCode: 'code' }, t);
    expect(result).toEqual({ kind: 'failure', reason: t('spaces:invite.failure.notAFriend') });
    expect(route.send).toHaveBeenCalledOnce();
    expect(spaceInviteFailureReason(new Error('Failed to fetch'), t)).toBe(t('spaces:invite.failure.unreachable'));
  });
});
