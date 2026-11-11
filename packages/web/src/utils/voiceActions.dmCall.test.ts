import { beforeEach, describe, expect, it, vi } from 'vitest';
const audio = vi.hoisted(() => ({ clearInputDenial: vi.fn(), resumeContext: vi.fn(async () => {}), setInputDevice: vi.fn(async () => null) }));
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => audio } }));
vi.mock('../hooks/useWebSocket', () => ({ wsSend: vi.fn(() => true) }));
vi.mock('../hooks/useLiveKit', () => ({ getActiveRoom: vi.fn(() => null) }));
import { acceptIncomingDmCall, canStartDmCall, startDmCall, cancelOutgoingDmCall, handleDisconnectAction, isDmCallRunning, joinDmCall, reconnectVoice } from './voiceActions';
import { wsSend } from '../hooks/useWebSocket';
import { useVoiceStore } from '../stores/voiceStore';
const DM = 'dm-1';
function resetCallState(): void {
  useVoiceStore.setState({ incomingCall: null, outgoingCall: null, activeDmCall: null, voiceUsers: new Map(), connectFn: null, disconnectFn: null, currentVoiceChannelId: null });
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(wsSend).mockReturnValue(true); resetCallState(); });
describe('native DM call actions', () => {
  it('allows an idle call and arms the microphone inside the tap', () => {
    expect(canStartDmCall(useVoiceStore.getState())).toBe(true); expect(startDmCall(DM)).toBe(true);
    expect(useVoiceStore.getState().outgoingCall).toEqual({ dmChannelId: DM, withCamera: false }); expect(wsSend).toHaveBeenCalledExactlyOnceWith({ type: 'dm_call_start', dmChannelId: DM });
    expect(audio.clearInputDenial).toHaveBeenCalled(); expect(audio.resumeContext).toHaveBeenCalled(); expect(audio.setInputDevice).toHaveBeenCalled();
  });
  it('remembers a video call request', () => { startDmCall(DM, { withCamera: true }); expect(useVoiceStore.getState().outgoingCall?.withCamera).toBe(true); });
  it.each([
    { outgoingCall: { dmChannelId: 'other', withCamera: false } }, { activeDmCall: { dmChannelId: 'other' } },
    { incomingCall: { dmChannelId: 'other', callerId: 'bob', callerName: 'Bob' } },
  ])('does not start or join while another native call slot is occupied', state => {
    useVoiceStore.setState(state); expect(canStartDmCall(useVoiceStore.getState())).toBe(false); expect(startDmCall(DM)).toBe(false); expect(joinDmCall(DM)).toBe(false); expect(wsSend).not.toHaveBeenCalled();
  });
  it.each(['start', 'join'] as const)('does not enter an unannounced %s when the socket is disconnected', action => {
    vi.mocked(wsSend).mockReturnValue(false); const connect = vi.fn(async () => {}); useVoiceStore.setState({ connectFn: connect });
    expect((action === 'start' ? startDmCall : joinDmCall)(DM)).toBe(false); expect(connect).not.toHaveBeenCalled();
    expect(useVoiceStore.getState()).toMatchObject({ outgoingCall: null, activeDmCall: null });
  });
  it('cancels only the outgoing native DM and leaves a later incoming ring alone', () => {
    useVoiceStore.setState({ outgoingCall: { dmChannelId: DM, withCamera: false }, incomingCall: { dmChannelId: 'other', callerId: 'bob', callerName: 'Bob' } });
    expect(cancelOutgoingDmCall('unknown')).toBe(false); expect(cancelOutgoingDmCall(DM)).toBe(true);
    expect(wsSend).toHaveBeenCalledExactlyOnceWith({ type: 'dm_call_end', dmChannelId: DM }); expect(useVoiceStore.getState().incomingCall?.dmChannelId).toBe('other');
  });
  it('distinguishes running and empty native rooms', () => {
    useVoiceStore.setState({ voiceUsers: new Map([[DM, ['bob']], ['other', []]]) });
    expect(isDmCallRunning(useVoiceStore.getState(), DM)).toBe(true); expect(isDmCallRunning(useVoiceStore.getState(), 'other')).toBe(false);
  });
  it('joins an active native room immediately with no signaled credentials', () => {
    const connect = vi.fn(async () => {}); useVoiceStore.setState({ connectFn: connect }); expect(joinDmCall(DM)).toBe(true);
    expect(useVoiceStore.getState().activeDmCall).toEqual({ dmChannelId: DM }); expect(wsSend).toHaveBeenCalledWith({ type: 'dm_call_accept', dmChannelId: DM }); expect(connect).toHaveBeenCalledWith(DM, true);
  });
  it('accepts a native ring and strips any obsolete fields on untyped input', () => {
    const connect = vi.fn(async () => {}); const ring = { dmChannelId: DM, callerId: 'bob', callerName: 'Bob', livekit: { token: 'untrusted', url: 'wss://unused.invalid' }, federatedCallId: 'obsolete' };
    useVoiceStore.setState({ connectFn: connect, incomingCall: ring }); expect(acceptIncomingDmCall()).toBe(true);
    expect(useVoiceStore.getState().activeDmCall).toEqual({ dmChannelId: DM }); expect(wsSend).toHaveBeenCalledWith({ type: 'dm_call_accept', dmChannelId: DM }); expect(connect).toHaveBeenCalledWith(DM, true);
  });
  it('retains an incoming ring and does not connect if its accept was not sent', () => {
    const connect = vi.fn(async () => {}); useVoiceStore.setState({ connectFn: connect, incomingCall: { dmChannelId: DM, callerId: 'bob', callerName: 'Bob' } }); vi.mocked(wsSend).mockReturnValue(false);
    expect(acceptIncomingDmCall()).toBe(false); expect(useVoiceStore.getState().incomingCall?.dmChannelId).toBe(DM); expect(connect).not.toHaveBeenCalled();
  });
  it('accepting without a ring is a no-op', () => { expect(acceptIncomingDmCall()).toBe(false); expect(wsSend).not.toHaveBeenCalled(); });
  it('hangs up the active native call without using the newer incoming ring', () => {
    const disconnect = vi.fn(async () => {}); useVoiceStore.setState({ disconnectFn: disconnect, activeDmCall: { dmChannelId: DM }, incomingCall: { dmChannelId: 'other', callerId: 'bob', callerName: 'Bob' } });
    handleDisconnectAction(); expect(wsSend).toHaveBeenCalledExactlyOnceWith({ type: 'dm_call_end', dmChannelId: DM }); expect(useVoiceStore.getState().activeDmCall).toBeNull(); expect(disconnect).toHaveBeenCalledOnce();
  });
  it('retries the native room ID, without a call-key/origin fallback', () => {
    const connect = vi.fn(async () => {}); useVoiceStore.setState({ connectFn: connect, activeDmCall: { dmChannelId: DM } }); reconnectVoice(); expect(connect).toHaveBeenCalledWith(DM, true);
  });
});
