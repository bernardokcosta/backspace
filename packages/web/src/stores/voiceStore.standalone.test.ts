import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) } }));
vi.mock('../hooks/useWebSocket', () => ({ wsSend: vi.fn(() => true) }));
import { useVoiceStore } from './voiceStore';
import { useAuthStore } from './authStore';
import { sendDmCallEnd, sendDmCallReject } from '../utils/dmCall';
import { wsSend } from '../hooks/useWebSocket';
afterEach(() => { useVoiceStore.setState({ disconnectFn: null }); useVoiceStore.getState().resetSession(); vi.restoreAllMocks(); });
describe('native voice/call session state', () => {
  it('ends/declines using only the local DM id over the sole socket', () => {
    sendDmCallEnd({ dmChannelId: 'dm' }); sendDmCallReject({ dmChannelId: 'dm' });
    expect(wsSend).toHaveBeenNthCalledWith(1, { type: 'dm_call_end', dmChannelId: 'dm' });
    expect(wsSend).toHaveBeenNthCalledWith(2, { type: 'dm_call_reject', dmChannelId: 'dm' });
  });
  it('session reset disconnects live media and clears all call state but preserves microphone/device preferences', () => {
    const disconnect = vi.fn(async () => {});
    useVoiceStore.setState({ disconnectFn: disconnect, currentVoiceChannelId: 'channel', incomingCall: { dmChannelId: 'dm', callerId: 'bob', callerName: 'Bob' },
      voiceConnectionStatus: 'connected', isLiveKitConnected: true, inputVolume: 120, outputVolume: 85, inputDeviceId: 'synthetic-device', rnnoiseEnabled: false });
    useVoiceStore.getState().resetSession(); expect(disconnect).toHaveBeenCalledTimes(1);
    expect(useVoiceStore.getState()).toMatchObject({ currentVoiceChannelId: null, incomingCall: null, activeDmCall: null, outgoingCall: null,
      isLiveKitConnected: false, voiceConnectionStatus: 'disconnected', inputVolume: 120, outputVolume: 85, inputDeviceId: 'synthetic-device', rnnoiseEnabled: false });
    expect(useVoiceStore.getState()).not.toHaveProperty('livekitHostOrigin'); expect(useVoiceStore.getState()).not.toHaveProperty('clearVoiceUsersForOrigin');
  });
  it('leaving native space voice removes only self from the sidebar and retains other participants', () => {
    useAuthStore.setState({ user: { id: 'me' } as never });
    useVoiceStore.setState({ currentVoiceChannelId: 'channel', voiceUsers: new Map([['channel', ['me', 'bob']]]) });
    useVoiceStore.getState().leaveVoice(); expect(useVoiceStore.getState().voiceUsers.get('channel')).toEqual(['bob']);
  });
});
