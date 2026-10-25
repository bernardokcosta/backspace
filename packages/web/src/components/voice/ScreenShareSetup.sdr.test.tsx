import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenShareSetup } from './ScreenShareSetup';
import { useVoiceStore } from '../../stores/voiceStore';
import { useScreenShareSetupStore } from '../../stores/screenShareSetupStore';

const capture = vi.hoisted(() => ({ stage: vi.fn(), apply: vi.fn(), stop: vi.fn(), publish: vi.fn(), capability: vi.fn() }));
vi.mock('../../utils/screenShare', () => ({
  stageScreenCapture: capture.stage, applyStagedCaptureConfig: capture.apply, stopStagedCapture: capture.stop,
  publishScreenShare: capture.publish, isScreenCaptureSupported: () => true,
  isCaptureCancellation: (error: Error) => error.name === 'AbortError', canAddScreenShareAudioLater: () => true,
}));
vi.mock('../../utils/sdrScreenCapture', async (original) => ({
  ...await original<typeof import('../../utils/sdrScreenCapture')>(), getSdrCaptureCapability: capture.capability,
}));
vi.mock('./StreamQualityControls', () => ({ StreamQualityControls: () => null, StreamSummary: () => null, StreamHostSubtitle: () => null }));
vi.mock('../../hooks/usePortalContainer', () => ({ usePortalContainer: () => document.body }));
vi.mock('../../hooks/useLiveKit', () => ({ getActiveRoom: () => ({ fixture: true }) }));
vi.mock('../../utils/voice', () => ({ broadcastVoiceStatus: vi.fn() }));
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));

const source = { id: 'screen:1:0', name: 'Controlled source', isScreen: true,
  thumbnailDataUrl: 'data:image/png;base64,iVBORw0KGgo=', appIconDataUrl: null };
const preselect = vi.fn(); const select = vi.fn();
function fakeStream() {
  const video = new EventTarget() as EventTarget & { readyState: string; stop: () => void };
  video.readyState = 'live'; video.stop = vi.fn();
  return { getVideoTracks: () => [video], getTracks: () => [video], getAudioTracks: () => [] } as unknown as MediaStream;
}
let first: MediaStream; let second: MediaStream;

beforeEach(() => {
  first = fakeStream(); second = fakeStream();
  capture.stage.mockReset().mockResolvedValueOnce(first).mockResolvedValue(second);
  capture.apply.mockReset().mockResolvedValue(undefined); capture.stop.mockReset();
  capture.publish.mockReset().mockResolvedValue(true); capture.capability.mockReset().mockResolvedValue({ supported: true });
  preselect.mockReset().mockResolvedValue({ ok: true }); select.mockReset();
  window.backspace = { platform: 'win32', getScreenSharePickerMode: async () => 'app', getScreenSources: async () => [source],
    preselectScreenSource: preselect, selectScreenSource: select, onScreenShareSources: vi.fn() } as unknown as BackspaceElectronAPI;
  useVoiceStore.setState({ isScreenSharing: false, screenShareConfig: { ...useVoiceStore.getInitialState().screenShareConfig, forceSdr: false } });
  useScreenShareSetupStore.setState({ isOpen: true });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); delete window.backspace; vi.restoreAllMocks(); });

describe('SDR setup capture transitions', () => {
  it.each(['capability', 'preselection'])('blocks the legacy %s contract without silently clearing Force SDR', async (missing) => {
    useVoiceStore.getState().setScreenShareConfig({ forceSdr: true });
    if (missing === 'capability') capture.capability.mockResolvedValue({ supported: false, reason: 'bridge' });
    else preselect.mockResolvedValue(undefined);
    render(<ScreenShareSetup />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/cannot guarantee borderless/i));
    expect(capture.stage).not.toHaveBeenCalled(); expect(capture.publish).not.toHaveBeenCalled();
    expect(useVoiceStore.getState().screenShareConfig.forceSdr).toBe(true);
  });
  it('blocks denied consent before staging and explicitly requests permission again without publishing', async () => {
    useVoiceStore.getState().setScreenShareConfig({ forceSdr: true });
    preselect.mockResolvedValueOnce({ ok: false, reason: 'denied-user' }).mockResolvedValue({ ok: true });
    render(<ScreenShareSetup />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Request permission again/i })).toBeEnabled());
    expect(capture.stage).not.toHaveBeenCalled(); expect(capture.publish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Request permission again/i }));
    await waitFor(() => expect(capture.stage).toHaveBeenCalledOnce());
    expect(preselect).toHaveBeenCalledTimes(2); expect(capture.publish).not.toHaveBeenCalled();
  });
  it('does not restart or retain a permission request after cancellation', async () => {
    useVoiceStore.getState().setScreenShareConfig({ forceSdr: true });
    let reply: (value: DesktopSdrPreselectionResult) => void = () => {};
    preselect.mockImplementationOnce(() => new Promise<DesktopSdrPreselectionResult>((resolve) => { reply = resolve; }));
    render(<ScreenShareSetup />);
    await waitFor(() => expect(preselect).toHaveBeenCalledOnce());
    expect(capture.stage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(select).toHaveBeenCalledWith(null);
    await act(async () => reply({ ok: true }));
    expect(capture.stage).not.toHaveBeenCalled(); expect(capture.publish).not.toHaveBeenCalled();
  });
  it('takes a fresh preview of the selected source after Force SDR changes', async () => {
    render(<ScreenShareSetup />);
    await waitFor(() => expect(capture.stage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /Start stream/i })).toBeEnabled());
    act(() => useVoiceStore.getState().setScreenShareConfig({ forceSdr: true }));
    await waitFor(() => expect(capture.stage).toHaveBeenCalledTimes(2));
    expect(preselect).toHaveBeenLastCalledWith(source.id, expect.any(Boolean), { forceSdr: true });
    expect(capture.stop).toHaveBeenCalledWith(first);
    expect(capture.stage.mock.calls[0]?.[0]?.signal.aborted).toBe(true);
    expect(capture.stage.mock.calls[1]?.[0]?.forceSdr).toBe(true);
    await waitFor(() => expect(screen.getByRole('button', { name: /Start stream/i })).toBeEnabled());
  });

  it('aborts an in-flight first-frame handoff and clears preselection when setup is closed', async () => {
    let resolve: (stream: MediaStream) => void = () => {};
    capture.stage.mockReset().mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<ScreenShareSetup />);
    await waitFor(() => expect(capture.stage).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(capture.stage.mock.calls[0]?.[0]?.signal.aborted).toBe(true);
    expect(select).toHaveBeenCalledWith(null);
    await act(async () => { resolve(first); });
    expect(capture.stop).toHaveBeenCalledWith(first);
    expect(capture.publish).not.toHaveBeenCalled();
  });

  it('does not fall through to raw capture when SDR preselection is rejected', async () => {
    useVoiceStore.getState().setScreenShareConfig({ forceSdr: true });
    preselect.mockRejectedValueOnce(new Error('source vanished'));
    render(<ScreenShareSetup />);
    await waitFor(() => expect(preselect).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/permission could not be confirmed/i));
    expect(capture.stage).not.toHaveBeenCalled();
  });

  it('transfers the same staged track to publication without aborting it when setup closes', async () => {
    const rendered = render(<ScreenShareSetup />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Start stream/i })).toBeEnabled());
    const signal = capture.stage.mock.calls[0]?.[0]?.signal;
    fireEvent.click(screen.getByRole('button', { name: /Start stream/i }));
    await waitFor(() => expect(useScreenShareSetupStore.getState().isOpen).toBe(false));
    expect(capture.publish).toHaveBeenCalledWith(expect.objectContaining({ fixture: true }), first, { sourceId: source.id, pickerMode: 'app' });
    rendered.unmount();
    expect(signal.aborted).toBe(false);
    expect(capture.stop).not.toHaveBeenCalledWith(first);
  });

  it('does not adopt a late publication result or close a newly reopened setup', async () => {
    let resolvePublish: (ok: boolean) => void = () => {};
    capture.publish.mockImplementationOnce(() => new Promise<boolean>((resolve) => { resolvePublish = resolve; }));
    render(<ScreenShareSetup />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Start stream/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Start stream/i }));
    await waitFor(() => expect(capture.publish).toHaveBeenCalledOnce());
    act(() => useScreenShareSetupStore.setState({ isOpen: false }));
    act(() => useScreenShareSetupStore.setState({ isOpen: true }));
    await waitFor(() => expect(capture.stage).toHaveBeenCalledTimes(2));
    await act(async () => resolvePublish(false));
    expect(useScreenShareSetupStore.getState().isOpen).toBe(true);
    await waitFor(() => expect(screen.getByRole('button', { name: /Start stream/i })).toBeEnabled());
  });

  it('disarms and ignores a late source-preselection reply after unmount', async () => {
    let resolvePreselect: () => void = () => {};
    preselect.mockImplementationOnce(() => new Promise<void>((resolve) => { resolvePreselect = resolve; }));
    const view = render(<ScreenShareSetup />);
    await waitFor(() => expect(preselect).toHaveBeenCalledOnce());
    view.unmount();
    expect(select).toHaveBeenCalledWith(null);
    await act(async () => resolvePreselect());
    expect(capture.stage).not.toHaveBeenCalled();
  });
});
