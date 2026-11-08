import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useJunoStore } from '../../stores/junoStore';
import { useUIStore } from '../../stores/uiStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useSoundboardStore } from '../../stores/soundboardStore';
import { useScreenShareSetupStore } from '../../stores/screenShareSetupStore';
import { DEFAULT_JUNO_PREFERENCES, useJunoPreferences } from '../../stores/junoPreferences';
import { JunoMusic } from './JunoMusic';
import { SoundboardController } from '../voice/SoundboardController';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
const player = vi.hoisted(() => ({ update: vi.fn(), retry: vi.fn(), dispose: vi.fn() }));
vi.mock('../../audio/junoMusic', async importOriginal => ({ ...await importOriginal<typeof import('../../audio/junoMusic')>(), createJunoMusicPlayer: () => player }));
const target = { accountId: 'a', selfId: 'host-a', origin: 'https://remote.test', channelId: 'voice' };
beforeEach(() => {
  vi.clearAllMocks(); vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  useJunoStore.getState().reset(); useJunoStore.getState().bind(target, true);
  useJunoStore.setState({ snapshot: { revision: 1, game: null }, open: true });
  useJunoPreferences.setState(DEFAULT_JUNO_PREFERENCES);
  useVoiceStore.setState({ currentVoiceChannelId: 'voice', isLiveKitConnected: true, voiceConnectionStatus: 'connected', isDeafened: false, isMuted: false, outputVolume: 100, spaceDeafenedUserIds: new Set(), incomingCall: null });
  useSpaceStore.setState({ spaceChannelIndex: new Map([['voice', { spaceId: 'space', origin: target.origin, type: 'voice' }]]) });
  useUIStore.setState({ isMobile: false, activeModal: null, mobileStack: [], voiceChatOpen: false });
  useSoundboardStore.setState({ open: false }); useScreenShareSetupStore.setState({ isOpen: false });
});
afterEach(() => vi.restoreAllMocks());
describe('principal Juno view music eligibility', () => {
  it('requires an actual token-owned table lease, not an open flag or ongoing call', () => {
    render(<JunoMusic target={target} />); expect(player.update).toHaveBeenLastCalledWith(false, .2);
    let release!: () => void; act(() => { release = useJunoStore.getState().presentView(target); }); expect(player.update).toHaveBeenLastCalledWith(true, .2);
    act(release); expect(player.update).toHaveBeenLastCalledWith(false, .2);
  });
  it.each(['mosaic', 'covered-mobile', 'popped-mobile', 'modal', 'deafen', 'space-deafen', 'output-zero', 'local-zero', 'disconnect', 'access-loss', 'wrong-origin'])('pauses for %s', mode => {
    useJunoStore.getState().presentView(target); render(<JunoMusic target={target} />); expect(player.update).toHaveBeenLastCalledWith(true, .2);
    act(() => {
      if (mode === 'mosaic') useJunoStore.setState({ open: false });
      if (mode === 'covered-mobile') useUIStore.setState({ isMobile: true, mobileStack: [{ screen: 'voice-full' }, { screen: 'chat' }] });
      if (mode === 'popped-mobile') useUIStore.setState({ isMobile: true, mobileStack: [] });
      if (mode === 'modal') useUIStore.setState({ activeModal: 'settings' });
      if (mode === 'deafen') useVoiceStore.setState({ isDeafened: true });
      if (mode === 'space-deafen') useVoiceStore.setState({ spaceDeafenedUserIds: new Set(['space:host-a']) });
      if (mode === 'output-zero') useVoiceStore.setState({ outputVolume: 0 });
      if (mode === 'local-zero') useJunoPreferences.getState().setMusicVolume(0);
      if (mode === 'disconnect') useVoiceStore.setState({ voiceConnectionStatus: 'reconnecting' });
      if (mode === 'access-loss') useJunoStore.setState({ snapshot: null });
      if (mode === 'wrong-origin') useSpaceStore.setState({ spaceChannelIndex: new Map([['voice', { spaceId: 'space', origin: '', type: 'voice' }]]) });
    });
    expect(player.update.mock.calls.at(-1)?.[0]).toBe(false);
  });
  it('pauses on hidden/blurred windows and resumes only while actually foreground', () => {
    useJunoStore.getState().presentView(target); render(<JunoMusic target={target} />);
    act(() => window.dispatchEvent(new Event('blur'))); expect(player.update.mock.calls.at(-1)?.[0]).toBe(false);
    act(() => window.dispatchEvent(new Event('focus'))); expect(player.update.mock.calls.at(-1)?.[0]).toBe(true);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange'))); expect(player.update.mock.calls.at(-1)?.[0]).toBe(false); visibility.mockRestore();
  });
  it.each(['soundboard', 'screen-share-setup'] as const)('pauses under the independent %s overlay and resumes on close', overlay => {
    useJunoStore.getState().presentView(target); render(<JunoMusic target={target} />);
    const setOpen = (open: boolean) => overlay === 'soundboard' ? useSoundboardStore.getState().setOpen(open)
      : useScreenShareSetupStore.setState({ isOpen: open });
    expect(player.update).toHaveBeenLastCalledWith(true, .2);
    act(() => setOpen(true)); expect(useUIStore.getState().activeModal).toBeNull();
    expect(player.update).toHaveBeenLastCalledWith(false, .2);
    act(() => setOpen(false)); expect(player.update).toHaveBeenLastCalledWith(true, .2);
  });
  it('pauses under the real soundboard dialog even when activeModal remains empty', () => {
    vi.spyOn(useSoundboardStore.getState(), 'load').mockResolvedValue();
    useSpaceStore.setState({ channelToSpaceMap: new Map([['voice', 'space']]), channelOriginMap: new Map([['voice', target.origin]]) });
    useJunoStore.getState().presentView(target); render(<><JunoMusic target={target} /><SoundboardController /></>);
    act(() => useSoundboardStore.getState().setOpen(true));
    expect(screen.getByRole('dialog')).toBeInTheDocument(); expect(useUIStore.getState().activeModal).toBeNull();
    expect(player.update).toHaveBeenLastCalledWith(false, .2);
    act(() => useSoundboardStore.getState().setOpen(false)); expect(screen.queryByRole('dialog')).toBeNull();
    expect(player.update).toHaveBeenLastCalledWith(true, .2);
  });
  it('pauses while an incoming-call modal covers the table without changing the current call', () => {
    useJunoStore.getState().presentView(target); render(<JunoMusic target={target} />);
    act(() => useVoiceStore.setState({ incomingCall: { dmChannelId: 'dm', federatedCallId: null, callOrigin: null, callerId: 'caller', callerName: 'Caller', livekit: null } }));
    expect(player.update).toHaveBeenLastCalledWith(false, .2); expect(useVoiceStore.getState().currentVoiceChannelId).toBe('voice');
    act(() => useVoiceStore.setState({ incomingCall: null })); expect(player.update).toHaveBeenLastCalledWith(true, .2);
  });
  it('recognizes foreground keyboard/input focus even if a host misses the window focus event', () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    useJunoStore.getState().presentView(target); render(<JunoMusic target={target} />); expect(player.update.mock.calls.at(-1)?.[0]).toBe(false);
    vi.mocked(document.hasFocus).mockReturnValue(true); act(() => document.dispatchEvent(new Event('focusin')));
    expect(player.update.mock.calls.at(-1)?.[0]).toBe(true);
  });
  it('obeys independent music/output gains without changing global settings, and ignores microphone mute', () => {
    useJunoStore.getState().presentView(target); render(<JunoMusic target={target} />);
    act(() => { useVoiceStore.setState({ isMuted: true, outputVolume: 50, soundEffectVolume: 0 }); useJunoPreferences.getState().setMusicVolume(50); });
    expect(player.update).toHaveBeenLastCalledWith(true, .05); expect(useVoiceStore.getState().outputVolume).toBe(50);
  });
  it('does not let an old lease clear a new view and erases leases on a target change', () => {
    const a = useJunoStore.getState().presentView(target), b = useJunoStore.getState().presentView(target); a();
    expect(useJunoStore.getState().presentedViews.size).toBe(1);
    useJunoStore.getState().bind({ ...target, selfId: 'other' }, true); b(); expect(useJunoStore.getState().presentedViews.size).toBe(0);
  });
});
