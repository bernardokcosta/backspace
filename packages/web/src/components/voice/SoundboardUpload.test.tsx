import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { soundboardWavDuration } from '@backspace/shared/src/soundboard';
import { SoundboardUpload } from './SoundboardUpload';

const mocks = vi.hoisted(() => ({ decode: vi.fn(), upload: vi.fn(), start: vi.fn() }));
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({
  ensureContext: () => ({ decodeAudioData: mocks.decode, createBufferSource: () => ({ connect: vi.fn(), disconnect: vi.fn(), stop: vi.fn(), start: mocks.start }) }),
  resumeContext: async () => {}, getMasterOutput: () => ({}),
}) } }));
vi.mock('../../utils/crossStoreResolvers', () => ({ getApiForOrigin: () => ({ soundboard: { upload: mocks.upload } }) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decode.mockResolvedValue({ duration: 20, length: 960000, numberOfChannels: 1, getChannelData: () => new Float32Array(960000) });
  mocks.upload.mockResolvedValue({});
  vi.stubGlobal('OfflineAudioContext', class {
    destination = {};
    constructor(readonly channels: number, readonly length: number, readonly sampleRate: number) {}
    createBufferSource() { return { connect: vi.fn(), start: vi.fn() }; }
    async startRendering() { return { getChannelData: () => new Float32Array(this.length) }; }
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('soundboard crop boundary UX', () => {
  it.each([[6.01, 16.01, 10], [0.5, 0.6, 0.1]])('previews and uploads selection %s → %s', async (start, end, duration) => {
    const done = vi.fn();
    render(<SoundboardUpload origin="https://remote.test" spaceId="space" maxDuration={10} onDone={done} onCancel={vi.fn()} />);
    const file = new File(['source'], 'Victory.wav', { type: 'audio/wav' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(0) });
    fireEvent.change(screen.getByLabelText('Choose audio'), { target: { files: [file] } });
    await screen.findByRole('spinbutton', { name: 'Start (seconds)' });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Start (seconds)' }), { target: { value: String(start) } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'End (seconds)' }), { target: { value: String(end) } });
    const preview = screen.getByRole('button', { name: 'Preview' });
    const add = screen.getByRole('button', { name: 'Add sound' });
    expect(preview).toBeEnabled(); expect(add).toBeEnabled();
    fireEvent.click(preview);
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith(0, start, duration));
    fireEvent.click(add);
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    const [space, payload] = mocks.upload.mock.calls[0]!;
    expect(space).toBe('space');
    const bytes = Uint8Array.from(atob(payload.audio), c => c.charCodeAt(0));
    expect(soundboardWavDuration(bytes)).toBe(duration);
  });
});

describe('soundboard drag selection and limits UX', () => {
  const pickFile = async (maxDuration = 30) => {
    render(<SoundboardUpload origin="https://remote.test" spaceId="space" maxDuration={maxDuration} onDone={vi.fn()} onCancel={vi.fn()} />);
    const file = new File(['source'], 'Victory.wav', { type: 'audio/wav' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(0) });
    fireEvent.change(screen.getByLabelText('Choose audio'), { target: { files: [file] } });
    await screen.findByRole('spinbutton', { name: 'Start (seconds)' });
  };

  const waveAt = () => {
    const wave = screen.getByRole('group', { name: 'Drag across the waveform to select' });
    wave.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 80, right: 200, bottom: 80, x: 0, y: 0, toJSON: () => ({}) });
    return wave;
  };

  it('drags on the waveform to set the selection', async () => {
    await pickFile();
    const wave = waveAt();
    fireEvent.pointerDown(wave, { clientX: 20, pointerId: 1 });
    fireEvent.pointerMove(wave, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(wave, { pointerId: 1 });
    // 20s fixture over 200px: 20px -> 2s, 100px -> 10s
    expect(screen.getByRole('spinbutton', { name: 'Start (seconds)' })).toHaveValue(2);
    expect(screen.getByRole('spinbutton', { name: 'End (seconds)' })).toHaveValue(10);
  });

  it('offers reset back to the full selection once narrowed', async () => {
    await pickFile();
    expect(screen.queryByRole('button', { name: 'Use full audio' })).not.toBeInTheDocument();
    const wave = waveAt();
    fireEvent.pointerDown(wave, { clientX: 20, pointerId: 1 });
    fireEvent.pointerMove(wave, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(wave, { pointerId: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Use full audio' }));
    expect(screen.getByRole('spinbutton', { name: 'Start (seconds)' })).toHaveValue(0);
    expect(screen.getByRole('spinbutton', { name: 'End (seconds)' })).toHaveValue(20);
  });

  it('names the over-limit state and blocks adding', async () => {
    await pickFile(5);
    // Pick clamps to the 5s cap; widening past it names the violation.
    fireEvent.change(screen.getByRole('spinbutton', { name: 'End (seconds)' }), { target: { value: '15' } });
    expect(screen.getByText(/Exceeds the current duration limit/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add sound' })).toBeDisabled();
  });

  it('keeps reset visible for an over-long drag, so the invalid selection is escapable', async () => {
    await pickFile(5);
    const wave = waveAt();
    fireEvent.pointerDown(wave, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(wave, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(wave, { pointerId: 1 });
    expect(screen.getByText(/Exceeds the current duration limit/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use full audio' })).toBeInTheDocument();
  });

  it('labels the selection bounds against the total', async () => {
    await pickFile();
    expect(screen.getByText('00:00')).toBeInTheDocument();
    expect(screen.getByText('00:20')).toBeInTheDocument();
  });
});
