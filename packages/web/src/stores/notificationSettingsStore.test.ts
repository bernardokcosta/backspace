import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveChannelNotificationPolicy, type NotificationSetting } from '@veyvox/shared';
const { list, updateSpace, updateChannel } = vi.hoisted(() => ({ list: vi.fn(), updateSpace: vi.fn(), updateChannel: vi.fn() }));
vi.mock('../api/client', () => ({ api: { notificationSettings: { list, updateSpace, updateChannel } } }));
import { notificationSettingKey, selectChannelNotificationPolicy, useNotificationSettingsStore } from './notificationSettingsStore';
const store = () => useNotificationSettingsStore.getState();
const get = (spaceId: string, channelId: string | null = null) => store().settings.get(notificationSettingKey({ spaceId, channelId }));
function setting(over: Partial<NotificationSetting> & Pick<NotificationSetting, 'spaceId'>): NotificationSetting {
  return { channelId: null, level: null, muted: false, mutedUntil: null, updatedAt: 1, ...over };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => { list.mockReset(); updateSpace.mockReset(); updateChannel.mockReset(); store().reset(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); store().reset(); });
describe('native notification settings', () => {
  it('separates a space from its equal-id channel without an origin partition', () => {
    expect(notificationSettingKey({ spaceId: 'x', channelId: null })).not.toBe(notificationSettingKey({ spaceId: 's', channelId: 'x' }));
    expect(store()).not.toHaveProperty('forgetOrigin');
  });
  it('loads only the current API and replaces a complete snapshot', async () => {
    store().apply(setting({ spaceId: 'gone', level: 'nothing' })); list.mockResolvedValue({ settings: [setting({ spaceId: 'kept', level: 'all' })] });
    await store().load(); expect(list).toHaveBeenCalledExactlyOnceWith(); expect(get('gone')).toBeUndefined(); expect(get('kept')?.level).toBe('all');
  });
  it.each([[20, 'all'], [5, 'nothing']] as const)('reconciles a pushed write at version %s over an in-flight snapshot', async (updatedAt, level) => {
    const pending = deferred<{ settings: NotificationSetting[] }>(); list.mockReturnValueOnce(pending.promise); const loading = store().load();
    store().apply(setting({ spaceId: 's', level: 'all', updatedAt })); pending.resolve({ settings: [setting({ spaceId: 's', level: 'nothing', updatedAt: 10 })] });
    await loading; expect(get('s')?.level).toBe(level);
  });
  it('discards an older listing superseded by a newer one', async () => {
    const first = deferred<{ settings: NotificationSetting[] }>(), second = deferred<{ settings: NotificationSetting[] }>();
    list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise); const a = store().load(), b = store().load();
    second.resolve({ settings: [setting({ spaceId: 'new' })] }); await b; first.resolve({ settings: [setting({ spaceId: 'old' })] }); await a;
    expect(get('new')).toBeDefined(); expect(get('old')).toBeUndefined();
  });
  it('drops a previous-session listing even when a new load has the same run number', async () => {
    const old = deferred<{ settings: NotificationSetting[] }>(); list.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ settings: [setting({ spaceId: 's', level: 'all' })] });
    const pending = store().load(); store().reset(); await store().load(); old.resolve({ settings: [setting({ spaceId: 's', level: 'nothing' })] }); await pending;
    expect(get('s')?.level).toBe('all');
  });
  it('keeps the current snapshot on a failed refresh', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {}); store().apply(setting({ spaceId: 's', level: 'all' })); list.mockRejectedValueOnce(new Error('synthetic unavailable'));
    await store().load(); expect(get('s')?.level).toBe('all');
  });
  it('keeps the newer write and a clearing tombstone against old pushes', () => {
    store().apply(setting({ spaceId: 's', level: 'all', updatedAt: 10 })); store().apply(setting({ spaceId: 's', level: 'nothing', updatedAt: 5 }));
    expect(get('s')?.level).toBe('all'); store().apply(setting({ spaceId: 's', level: null, updatedAt: 11 })); store().apply(setting({ spaceId: 's', level: 'all', updatedAt: 10 }));
    expect(get('s')?.level).toBeNull();
  });
  it('updates a native space and applies the authoritative response', async () => {
    const answer = setting({ spaceId: 's', level: 'nothing', updatedAt: 3 }); updateSpace.mockResolvedValueOnce(answer);
    await expect(store().update({ spaceId: 's', channelId: null }, { level: 'nothing' })).resolves.toEqual(answer);
    expect(updateSpace).toHaveBeenCalledExactlyOnceWith('s', { level: 'nothing' }); expect(get('s')).toEqual(answer);
  });
  it('updates a channel through the channel endpoint, not the space endpoint', async () => {
    updateChannel.mockResolvedValueOnce(setting({ spaceId: 's', channelId: 'c', muted: true, mutedUntil: 99, updatedAt: 3 }));
    await store().update({ spaceId: 's', channelId: 'c' }, { mute: '1h' }); expect(updateChannel).toHaveBeenCalledExactlyOnceWith('c', { mute: '1h' });
    expect(updateSpace).not.toHaveBeenCalled(); expect(get('s', 'c')?.muted).toBe(true);
  });
  it('retains an API refusal without making a local change', async () => {
    updateSpace.mockRejectedValueOnce(new Error('forbidden')); await expect(store().update({ spaceId: 's', channelId: null }, { level: 'all' })).rejects.toThrow('forbidden');
    expect(store().settings.size).toBe(0);
  });
  it('does not install a late mutation response into the next session', async () => {
    const old = deferred<NotificationSetting>(); updateSpace.mockReturnValueOnce(old.promise);
    const pending = store().update({ spaceId: 's', channelId: null }, { level: 'all' }); store().reset(); old.resolve(setting({ spaceId: 's', level: 'all' })); await pending;
    expect(store().settings.size).toBe(0);
  });
  it('ticks when the nearest timed mute ends, but never schedules an indefinite mute', () => {
    vi.useFakeTimers(); store().apply(setting({ spaceId: 's', muted: true, mutedUntil: Date.now() + 1000 }));
    const before = store().clock; vi.advanceTimersByTime(999); expect(store().clock).toBe(before); vi.advanceTimersByTime(2); expect(store().clock).not.toBe(before);
    store().apply(setting({ spaceId: 's', muted: true, mutedUntil: null })); expect(vi.getTimerCount()).toBe(0);
  });
});
describe('native notification policy inheritance', () => {
  const now = 1_000_000;
  it('defaults unknown channels to mentions and unmuted', () => {
    expect(resolveChannelNotificationPolicy(undefined, undefined, now)).toEqual({ level: 'mentions', levelSource: 'default', muted: false, mutedUntil: null, channelMuted: false, spaceMuted: false, suppressEveryone: false, suppressRoles: false });
    expect(selectChannelNotificationPolicy(store(), undefined, 'c', now).level).toBe('mentions');
  });
  it('inherits the space level, while a channel choice wins', () => {
    store().apply(setting({ spaceId: 's', level: 'all' })); expect(selectChannelNotificationPolicy(store(), 's', 'c', now).level).toBe('all');
    store().apply(setting({ spaceId: 's', channelId: 'c', level: 'nothing' })); expect(selectChannelNotificationPolicy(store(), 's', 'c', now)).toMatchObject({ level: 'nothing', levelSource: 'channel' });
  });
  it('handles channel/space mute expiry and indefinite/later combined mutes', () => {
    const space = setting({ spaceId: 's', muted: true, mutedUntil: now + 100 });
    expect(resolveChannelNotificationPolicy(space, setting({ spaceId: 's', channelId: 'c', muted: true, mutedUntil: now + 50 }), now).mutedUntil).toBe(now + 100);
    expect(resolveChannelNotificationPolicy(space, setting({ spaceId: 's', channelId: 'c', muted: true, mutedUntil: null }), now).mutedUntil).toBeNull();
    expect(resolveChannelNotificationPolicy(undefined, setting({ spaceId: 's', channelId: 'c', muted: true, mutedUntil: now }), now).muted).toBe(false);
    expect(resolveChannelNotificationPolicy(setting({ spaceId: 's', muted: true }), undefined, now)).toMatchObject({ muted: true, spaceMuted: true, channelMuted: false });
  });
  it('inherits mass-mention suppression from the space independently of channel level overrides', () => {
    const space = setting({ spaceId: 's', level: 'mentions', suppressEveryone: true, suppressRoles: true });
    const channel = { ...space, channelId: 'c', level: 'all' as const, suppressEveryone: false, suppressRoles: false };
    expect(resolveChannelNotificationPolicy(space, channel, now)).toMatchObject({ level: 'all', suppressEveryone: true, suppressRoles: true });
  });
});
