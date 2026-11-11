import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SOUNDBOARD_SETTINGS, type SoundboardDocument } from '@veyvox/shared/src/soundboard';
import { DEFAULT_EVERYONE_PERMISSIONS, permissionsToString } from '@veyvox/shared/src/permissions';
import type { User } from '@veyvox/shared';
const { list, play } = vi.hoisted(() => ({ list: vi.fn(), play: vi.fn() }));
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
vi.mock('../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), api: { soundboard: { list, play } } }));
import { useAuthStore } from './authStore';
import { soundboardKey, useSoundboardStore } from './soundboardStore';
import { useSpaceStore } from './spaceStore';
import { useVoiceStore } from './voiceStore';
import { RateLimitError } from '../api/client';
const store = () => useSoundboardStore.getState();
const document = (maxSounds: number): SoundboardDocument => ({ settings: { ...DEFAULT_SOUNDBOARD_SETTINGS, maxSounds }, sounds: [] });
const clip = { id: 'sound', spaceId: 'space', uploaderId: 'me', name: 'Sound', emoji: 'x', filename: '1.wav', durationSeconds: 1, createdAt: 1 };
beforeEach(() => { list.mockReset(); play.mockReset(); store().reset(); useAuthStore.setState({ user: null }); });
afterEach(() => vi.restoreAllMocks());
function preparePlayback(): string {
  useAuthStore.setState({ user: { id: 'me' } as User });
  useVoiceStore.setState({ ...useVoiceStore.getInitialState(), currentVoiceChannelId: 'voice', isLiveKitConnected: true, voiceConnectionStatus: 'connected' });
  useSpaceStore.setState({ spaceChannelIndex: new Map([['voice', { spaceId: 'space', type: 'voice' }]]), channelToSpaceMap: new Map([['voice', 'space']]),
    channelPermissions: new Map([['voice', permissionsToString(DEFAULT_EVERYONE_PERMISSIONS)]]) });
  const key = soundboardKey('space'); useSoundboardStore.setState({ entries: { [key]: { loading: false, document: { ...document(100), sounds: [clip] } } } }); return key;
}
describe('native soundboard playback submission', () => {
  it('coalesces button/shortcut submissions and respects the two-second cooldown', async () => {
    const key = preparePlayback(); let now = 10_000; vi.spyOn(Date, 'now').mockImplementation(() => now); let finish!: () => void;
    play.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue({ success: true });
    const first = store().play('space', clip.id, 'voice'); await store().play('space', clip.id, 'voice');
    expect(play).toHaveBeenCalledOnce(); expect(store().playback[key]?.pending).toBe(true); finish(); await first;
    now += 1999; await store().play('space', clip.id, 'voice'); expect(play).toHaveBeenCalledOnce();
    now++; await store().play('space', clip.id, 'voice'); expect(play).toHaveBeenCalledTimes(2);
  });
  it('respects Retry-After without automatically replaying a refused sound', async () => {
    const key = preparePlayback(); vi.spyOn(Date, 'now').mockReturnValue(10_000); play.mockRejectedValueOnce(new RateLimitError(2));
    await expect(store().play('space', clip.id, 'voice')).rejects.toBeInstanceOf(RateLimitError); expect(store().playback[key]).toEqual({ pending: false, availableAt: 12_000 });
    await store().play('space', clip.id, 'voice'); expect(play).toHaveBeenCalledOnce();
  });
  it('an old response cannot unlock a next-session equal-ID submission', async () => {
    const key = preparePlayback(); let oldFinish!: () => void, newFinish!: () => void;
    play.mockReturnValueOnce(new Promise<void>(resolve => { oldFinish = resolve; })).mockReturnValueOnce(new Promise<void>(resolve => { newFinish = resolve; }));
    const old = store().play('space', clip.id, 'voice'); store().reset(); preparePlayback(); const next = store().play('space', clip.id, 'voice');
    oldFinish(); await old; expect(store().playback[key]?.pending).toBe(true); newFinish(); await next; expect(store().playback[key]?.pending).toBe(false);
  });
  it('refuses disconnected, permission-muted and wrong-space/channel sessions but allows self mute', async () => {
    preparePlayback(); play.mockResolvedValue({ success: true }); useVoiceStore.setState({ permissionMutedUserIds: new Set(['space:me']) }); await store().play('space', clip.id, 'voice');
    useVoiceStore.setState({ permissionMutedUserIds: new Set(), isLiveKitConnected: false }); await store().play('space', clip.id, 'voice');
    useVoiceStore.setState({ isLiveKitConnected: true }); await store().play('other', clip.id, 'voice'); await store().play('space', clip.id, 'other'); expect(play).not.toHaveBeenCalled();
    useVoiceStore.setState({ isMuted: true }); await store().play('space', clip.id, 'voice'); expect(play).toHaveBeenCalledExactlyOnceWith('space', clip.id, 'voice');
  });
});
describe('native soundboard catalog lifecycle', () => {
  it('never adopts a previous-session catalog even for equal native space/account IDs', async () => {
    let finish!: (value: SoundboardDocument) => void;
    list.mockReturnValueOnce(new Promise<SoundboardDocument>(resolve => { finish = resolve; })).mockResolvedValueOnce(document(20));
    const old = store().load('space'); store().reset(); await store().load('space'); finish(document(10)); await old;
    expect(store().entries[soundboardKey('space')]?.document?.settings.maxSounds).toBe(20);
  });
  it('does not let an older refresh overwrite the newest list', async () => {
    let finish!: (value: SoundboardDocument) => void;
    list.mockReturnValueOnce(new Promise<SoundboardDocument>(resolve => { finish = resolve; })).mockResolvedValueOnce(document(20));
    const old = store().load('space'); await store().load('space'); finish(document(10)); await old;
    expect(list).toHaveBeenCalledWith('space');
    expect(store().entries[soundboardKey('space')]?.document?.settings.maxSounds).toBe(20);
  });
  it('keeps catalogs of distinct native spaces separate', async () => {
    list.mockResolvedValueOnce(document(10)).mockResolvedValueOnce(document(20)); await store().load('one'); await store().load('two');
    expect(store().entries[soundboardKey('one')]?.document?.settings.maxSounds).toBe(10); expect(store().entries[soundboardKey('two')]?.document?.settings.maxSounds).toBe(20);
  });
  it('drops an actionable stale catalog after an access refusal', async () => {
    list.mockResolvedValueOnce(document(10)).mockRejectedValueOnce(new Error('Forbidden')); await store().load('space'); await store().load('space');
    expect(store().entries[soundboardKey('space')]?.document).toBeUndefined(); expect(store().entries[soundboardKey('space')]?.error).toBeInstanceOf(Error);
  });
  it.each([null, 86400])('bounds a legacy duration cap %s to 30 seconds', async cap => {
    list.mockResolvedValueOnce({ settings: { ...DEFAULT_SOUNDBOARD_SETTINGS, maxDurationSeconds: cap }, sounds: [] }); await store().load('space');
    expect(store().entries[soundboardKey('space')]?.document?.settings.maxDurationSeconds).toBe(30);
  });
  it('retains a valid stricter duration cap', async () => {
    list.mockResolvedValueOnce({ settings: { ...DEFAULT_SOUNDBOARD_SETTINGS, maxDurationSeconds: 12 }, sounds: [] }); await store().load('space');
    expect(store().entries[soundboardKey('space')]?.document?.settings.maxDurationSeconds).toBe(12);
  });
});
