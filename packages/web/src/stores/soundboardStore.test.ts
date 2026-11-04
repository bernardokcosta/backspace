import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SOUNDBOARD_SETTINGS, type SoundboardDocument } from '@backspace/shared/src/soundboard';
import { useAuthStore } from './authStore';
import { soundboardKey, useSoundboardStore } from './soundboardStore';
import { useSpaceStore } from './spaceStore';
import { useVoiceStore } from './voiceStore';
import { RateLimitError } from '../api/client';
import type { User } from '@backspace/shared';
import { DEFAULT_EVERYONE_PERMISSIONS, permissionsToString } from '@backspace/shared/src/permissions';

const api = vi.hoisted(() => ({ list: vi.fn(), play: vi.fn() }));
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
vi.mock('../utils/crossStoreResolvers', async importOriginal => ({
  ...await importOriginal<typeof import('../utils/crossStoreResolvers')>(),
  getApiForOrigin: () => ({ soundboard: api }),
}));
const document = (maxSounds: number): SoundboardDocument => ({ settings: { ...DEFAULT_SOUNDBOARD_SETTINGS, maxSounds }, sounds: [] });
beforeEach(() => { vi.clearAllMocks(); useSoundboardStore.getState().reset(); useAuthStore.setState({ user: null }); });
afterEach(() => { vi.restoreAllMocks(); });

const clip = { id: 'sound', spaceId: 'space', uploaderId: 'me', name: 'Sound', emoji: 'x', filename: '1.wav', durationSeconds: 1, createdAt: 1 };
function preparePlayback(): string {
  useAuthStore.setState({ user: { id: 'me' } as User });
  useVoiceStore.setState({ ...useVoiceStore.getInitialState(), currentVoiceChannelId: 'voice', isLiveKitConnected: true, voiceConnectionStatus: 'connected' });
  useSpaceStore.setState({ spaceChannelIndex: new Map([['voice', { spaceId: 'space', origin: '', type: 'voice' }]]),
    channelOriginMap: new Map([['voice', '']]), channelToSpaceMap: new Map([['voice', 'space']]),
    channelPermissions: new Map([['voice', permissionsToString(DEFAULT_EVERYONE_PERMISSIONS)]]) });
  const key = soundboardKey('', 'space');
  useSoundboardStore.setState({ entries: { [key]: { loading: false, document: { ...document(100), sounds: [clip] } } } });
  return key;
}

describe('shared soundboard playback submission', () => {
  it('coalesces button/shortcut submissions and honors the two-second cooldown', async () => {
    const key = preparePlayback();
    let now = 10_000; vi.spyOn(Date, 'now').mockImplementation(() => now);
    let finish!: () => void;
    api.play.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue({ success: true });
    const first = useSoundboardStore.getState().play('', 'space', clip.id, 'voice');
    await useSoundboardStore.getState().play('', 'space', clip.id, 'voice');
    expect(api.play).toHaveBeenCalledOnce();
    expect(useSoundboardStore.getState().playback[key]?.pending).toBe(true);
    finish(); await first;
    now += 1999;
    await useSoundboardStore.getState().play('', 'space', clip.id, 'voice');
    expect(api.play).toHaveBeenCalledOnce();
    now++;
    await useSoundboardStore.getState().play('', 'space', clip.id, 'voice');
    expect(api.play).toHaveBeenCalledTimes(2);
  });

  it('uses Retry-After without replaying the rejected sound automatically', async () => {
    const key = preparePlayback();
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    api.play.mockRejectedValueOnce(new RateLimitError(2));
    await expect(useSoundboardStore.getState().play('', 'space', clip.id, 'voice')).rejects.toBeInstanceOf(RateLimitError);
    expect(useSoundboardStore.getState().playback[key]).toEqual({ pending: false, availableAt: 12_000 });
    await useSoundboardStore.getState().play('', 'space', clip.id, 'voice');
    expect(api.play).toHaveBeenCalledOnce();
  });

  it('does not let an old account/session response unlock a newer submission', async () => {
    const key = preparePlayback();
    let oldFinish!: () => void; let newFinish!: () => void;
    api.play.mockReturnValueOnce(new Promise<void>(r => { oldFinish = r; })).mockReturnValueOnce(new Promise<void>(r => { newFinish = r; }));
    const old = useSoundboardStore.getState().play('', 'space', clip.id, 'voice');
    useSoundboardStore.getState().reset(); preparePlayback();
    const current = useSoundboardStore.getState().play('', 'space', clip.id, 'voice');
    oldFinish(); await old;
    expect(useSoundboardStore.getState().playback[key]?.pending).toBe(true);
    newFinish(); await current;
    expect(useSoundboardStore.getState().playback[key]?.pending).toBe(false);
  });

  it('rejects stale, disconnected, permission-muted and wrong-origin sessions but allows self mute', async () => {
    preparePlayback();
    api.play.mockResolvedValue({ success: true });
    useVoiceStore.setState({ permissionMutedUserIds: new Set(['space:me']) });
    await useSoundboardStore.getState().play('', 'space', clip.id, 'voice');
    useVoiceStore.setState({ permissionMutedUserIds: new Set(), isLiveKitConnected: false });
    await useSoundboardStore.getState().play('', 'space', clip.id, 'voice');
    useVoiceStore.setState({ isLiveKitConnected: true });
    await useSoundboardStore.getState().play('https://other.test', 'space', clip.id, 'voice');
    expect(api.play).not.toHaveBeenCalled();
    useVoiceStore.setState({ isMuted: true });
    await useSoundboardStore.getState().play('', 'space', clip.id, 'voice');
    expect(api.play).toHaveBeenCalledOnce();
  });
});
describe('origin/account-scoped soundboard catalog', () => {
  it('keeps catalogs with equal space ids on different origins separate', async () => {
    api.list.mockResolvedValueOnce(document(10)).mockResolvedValueOnce(document(20));
    await useSoundboardStore.getState().load('', 'space');
    await useSoundboardStore.getState().load('https://remote.test', 'space');
    expect(useSoundboardStore.getState().entries[soundboardKey('', 'space')]?.document?.settings.maxSounds).toBe(10);
    expect(useSoundboardStore.getState().entries[soundboardKey('https://remote.test', 'space')]?.document?.settings.maxSounds).toBe(20);
  });
  it('never applies an older response after a newer refresh', async () => {
    let resolveOld!: (value: SoundboardDocument) => void;
    api.list.mockReturnValueOnce(new Promise<SoundboardDocument>(resolve => { resolveOld = resolve; })).mockResolvedValueOnce(document(20));
    const first = useSoundboardStore.getState().load('', 'space');
    await useSoundboardStore.getState().load('', 'space');
    resolveOld(document(10)); await first;
    expect(useSoundboardStore.getState().entries[soundboardKey('', 'space')]?.document?.settings.maxSounds).toBe(20);
  });
  it('invalidates pending responses across reset, even if the same account requests the same key again', async () => {
    let resolveOld!: (value: SoundboardDocument) => void;
    api.list.mockReturnValueOnce(new Promise<SoundboardDocument>(resolve => { resolveOld = resolve; })).mockResolvedValueOnce(document(20));
    const first = useSoundboardStore.getState().load('', 'space');
    useSoundboardStore.getState().reset();
    await useSoundboardStore.getState().load('', 'space');
    resolveOld(document(10)); await first;
    expect(useSoundboardStore.getState().entries[soundboardKey('', 'space')]?.document?.settings.maxSounds).toBe(20);
  });
  it('clears an actionable stale catalog when access is refused', async () => {
    api.list.mockResolvedValueOnce(document(10)).mockRejectedValueOnce(new Error('Forbidden'));
    await useSoundboardStore.getState().load('', 'space'); await useSoundboardStore.getState().load('', 'space');
    const entry = useSoundboardStore.getState().entries[soundboardKey('', 'space')];
    expect(entry?.document).toBeUndefined(); expect(entry?.error).toBeInstanceOf(Error);
  });
  it.each([
    ['a legacy null cap', null],
    ['an above-ceiling cap', 86400],
  ])('clamps %s from an older instance to the 30s ceiling', async (_label, cap) => {
    const legacy = { settings: { ...DEFAULT_SOUNDBOARD_SETTINGS, maxDurationSeconds: cap }, sounds: [] };
    api.list.mockResolvedValueOnce(legacy);
    await useSoundboardStore.getState().load('', 'space');
    expect(useSoundboardStore.getState().entries[soundboardKey('', 'space')]?.document?.settings.maxDurationSeconds).toBe(30);
  });
  it('keeps a within-ceiling cap from an older instance untouched', async () => {
    api.list.mockResolvedValueOnce({ settings: { ...DEFAULT_SOUNDBOARD_SETTINGS, maxDurationSeconds: 12 }, sounds: [] });
    await useSoundboardStore.getState().load('', 'space');
    expect(useSoundboardStore.getState().entries[soundboardKey('', 'space')]?.document?.settings.maxDurationSeconds).toBe(12);
  });
});
