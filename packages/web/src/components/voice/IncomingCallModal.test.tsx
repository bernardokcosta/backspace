import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../hooks/useWebSocket', () => ({ wsSend: vi.fn(() => true) }));
// jsdom has no AudioWorkletNode; the store's imports reach the voice stack.
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: () => ({
      clearInputDenial: vi.fn(),
      resumeContext: vi.fn(() => Promise.resolve()),
      setInputDevice: vi.fn(() => Promise.resolve(null)),
    }),
  },
}));

import { IncomingCallModal } from './IncomingCallModal';
import { wsSend } from '../../hooks/useWebSocket';
import { useVoiceStore } from '../../stores/voiceStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { initI18n } from '../../i18n';
import i18n from '../../i18n';

const RING = {
  dmChannelId: 'dm-1', callerId: 'caller', callerName: 'Caller@retained.invalid',
};

beforeEach(async () => {
  await initI18n();
  vi.clearAllMocks();
  useSpaceStore.setState({ dmChannels: [] });
  useVoiceStore.setState({
    incomingCall: RING,
    outgoingCall: null,
    activeDmCall: null,
    connectFn: null,
  });
});

describe('IncomingCallModal decline', () => {
  it('declines the native DM through the current socket without truncating the caller name', () => {
    render(<IncomingCallModal />);
    expect(screen.getByText(RING.callerName)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle(i18n.t('common:actions.decline')));

    expect(wsSend).toHaveBeenCalledWith({ type: 'dm_call_reject', dmChannelId: 'dm-1' });
    expect(useVoiceStore.getState().incomingCall).toBeNull();
  });

  it('leaves the call the client is in as it was', () => {
    const held = { dmChannelId: 'dm-other' };
    useVoiceStore.setState({ activeDmCall: held });
    render(<IncomingCallModal />);

    fireEvent.click(screen.getByTitle(i18n.t('common:actions.decline')));

    expect(useVoiceStore.getState().activeDmCall).toEqual(held);
  });
});

describe('IncomingCallModal accept', () => {
  it('joins the native DM ID and connects in the tap', () => {
    const connectFn = vi.fn().mockResolvedValue(undefined);
    useVoiceStore.setState({ connectFn });
    render(<IncomingCallModal />);

    fireEvent.click(screen.getByTitle(i18n.t('common:actions.accept')));

    const active = useVoiceStore.getState().activeDmCall;
    expect(active).toEqual({ dmChannelId: 'dm-1' });
    expect(wsSend).toHaveBeenCalledWith({ type: 'dm_call_accept', dmChannelId: 'dm-1' });
    expect(connectFn).toHaveBeenCalledWith('dm-1', true);
  });
});
