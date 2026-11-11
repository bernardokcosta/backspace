import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
vi.mock('../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));
import { clearSpaceVoiceForDmCall } from './voice';
import { wsSend } from '../hooks/useWebSocket';
import { useVoiceStore } from '../stores/voiceStore';
import { useAuthStore } from '../stores/authStore';
import { junoUser } from '../components/games/junoTestFixtures';
beforeEach(() => { vi.clearAllMocks(); useAuthStore.setState({ user: junoUser('me') }); useVoiceStore.setState({ currentVoiceChannelId: null, activeDmCall: null, voiceUsers: new Map() }); });
describe('native space voice reset for a DM call', () => {
  it('removes self from the prior channel and clears its channel selection', () => {
    useVoiceStore.setState({ currentVoiceChannelId: 'voice', voiceUsers: new Map([['voice', ['me', 'other']]]) }); clearSpaceVoiceForDmCall();
    expect(useVoiceStore.getState().currentVoiceChannelId).toBeNull(); expect(useVoiceStore.getState().voiceUsers.get('voice')).toEqual(['other']);
  });
  it('keeps the DM call the acceptor just established and does not send a separate leave', () => {
    useVoiceStore.setState({ currentVoiceChannelId: 'voice', activeDmCall: { dmChannelId: 'dm' }, voiceUsers: new Map([['voice', ['me']]]) }); clearSpaceVoiceForDmCall();
    expect(useVoiceStore.getState().activeDmCall).toEqual({ dmChannelId: 'dm' }); expect(wsSend).not.toHaveBeenCalled();
  });
  it('does nothing to an established DM when no space channel is selected', () => {
    useVoiceStore.setState({ activeDmCall: { dmChannelId: 'dm' } }); clearSpaceVoiceForDmCall();
    expect(useVoiceStore.getState().activeDmCall).toEqual({ dmChannelId: 'dm' }); expect(useVoiceStore.getState().currentVoiceChannelId).toBeNull();
  });
});
