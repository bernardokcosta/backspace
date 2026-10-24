import { describe, expect, it, vi } from 'vitest';
import type { SharedTextureImported, WebFrameMain } from 'electron';
import { createSdrCaptureTransport } from './sdrCaptureTransport';
import type { NativeSdrFrame } from './sdrCaptureTypes';

const SESSION = '8dfd1bcd-7b0d-4a1c-9031-40d830256b67';

function frame(id: string): NativeSdrFrame {
  const ntHandle = Buffer.alloc(8);
  ntHandle.writeBigUInt64LE(42n);
  return { frameId: id, ntHandle, width: 32, height: 16, timestampUs: 1000 };
}

function setup() {
  const target = { isDestroyed: () => false } as WebFrameMain;
  const released: Array<() => void> = [];
  const imported: SharedTextureImported[] = [];
  const importSharedTexture = vi.fn((options: { allReferencesReleased?: () => void }) => {
    released.push(options.allReferencesReleased!);
    const texture = { release: vi.fn() } as unknown as SharedTextureImported;
    imported.push(texture);
    return texture;
  });
  const sendSharedTexture = vi.fn(async () => {});
  const releaseFrame = vi.fn();
  const isTargetAllowed = vi.fn((candidate: WebFrameMain) => candidate === target);
  const transport = createSdrCaptureTransport({
    api: { importSharedTexture, sendSharedTexture },
    isTargetAllowed,
    releaseFrame,
  });
  return { target, released, imported, importSharedTexture, sendSharedTexture, releaseFrame, transport };
}

describe('SDR capture transport', () => {
  it('imports an SDR NT texture and retains native ownership until every GPU reference is released', async () => {
    const s = setup();
    const source = frame('one');
    await s.transport.sendSdrFrame(s.target, SESSION, source);

    expect(s.importSharedTexture).toHaveBeenCalledWith({
      textureInfo: {
        pixelFormat: 'bgra',
        colorSpace: { primaries: 'bt709', transfer: 'srgb', matrix: 'rgb', range: 'full' },
        codedSize: { width: 32, height: 16 },
        timestamp: 1000,
        handle: { ntHandle: source.ntHandle },
      },
      allReferencesReleased: expect.any(Function),
    });
    expect(s.sendSharedTexture).toHaveBeenCalledWith({ frame: s.target, importedSharedTexture: s.imported[0] }, { sessionId: SESSION });
    expect(s.imported[0]!.release).toHaveBeenCalledOnce();
    expect(s.releaseFrame).not.toHaveBeenCalled();
    s.released[0]!();
    s.released[0]!();
    expect(s.releaseFrame).toHaveBeenCalledExactlyOnceWith('one');
  });

  it('rejects a foreign target before importing and releases the unsent frame', async () => {
    const s = setup();
    await expect(s.transport.sendSdrFrame({ isDestroyed: () => false } as WebFrameMain, SESSION, frame('one'))).rejects.toThrow('target');
    expect(s.importSharedTexture).not.toHaveBeenCalled();
    expect(s.releaseFrame).toHaveBeenCalledExactlyOnceWith('one');
  });

  it('rejects a destroyed frame', async () => {
    const s = setup();
    s.target.isDestroyed = () => true;
    await expect(s.transport.sendSdrFrame(s.target, SESSION, frame('one'))).rejects.toThrow('target');
    expect(s.releaseFrame).toHaveBeenCalledExactlyOnceWith('one');
  });

  it('releases an unsent native frame if import fails', async () => {
    const s = setup();
    s.importSharedTexture.mockImplementationOnce(() => { throw new Error('import failed'); });
    await expect(s.transport.sendSdrFrame(s.target, SESSION, frame('one'))).rejects.toThrow('import failed');
    expect(s.releaseFrame).toHaveBeenCalledExactlyOnceWith('one');
  });

  it('releases the import on send failure but waits for GPU references before releasing native storage', async () => {
    const s = setup();
    s.sendSharedTexture.mockRejectedValueOnce(new Error('renderer vanished'));
    await expect(s.transport.sendSdrFrame(s.target, SESSION, frame('one'))).rejects.toThrow('renderer vanished');
    expect(s.imported[0]!.release).toHaveBeenCalledOnce();
    expect(s.releaseFrame).not.toHaveBeenCalled();
    s.released[0]!();
    expect(s.releaseFrame).toHaveBeenCalledExactlyOnceWith('one');
  });

  it('bounds retained native frames across sessions and never reuses held storage', async () => {
    const s = setup();
    for (const id of ['one', 'two', 'three']) await s.transport.sendSdrFrame(s.target, SESSION, frame(id));
    await expect(s.transport.sendSdrFrame(s.target, 'another-session', frame('four'))).rejects.toThrow('capacity');
    expect(s.importSharedTexture).toHaveBeenCalledTimes(3);
    expect(s.releaseFrame).toHaveBeenCalledExactlyOnceWith('four');
    s.released[0]!();
    await s.transport.sendSdrFrame(s.target, 'another-session', frame('five'));
    expect(s.importSharedTexture).toHaveBeenCalledTimes(4);
    expect(s.releaseFrame).not.toHaveBeenCalledWith('two');
    expect(s.releaseFrame).not.toHaveBeenCalledWith('three');
  });

  it('does not release the original retained frame when its id is presented again', async () => {
    const s = setup();
    await s.transport.sendSdrFrame(s.target, SESSION, frame('one'));
    await expect(s.transport.sendSdrFrame(s.target, SESSION, frame('one'))).rejects.toThrow('duplicate');
    expect(s.releaseFrame).not.toHaveBeenCalled();
    s.released[0]!();
    expect(s.releaseFrame).toHaveBeenCalledExactlyOnceWith('one');
  });

  it.each([
    { width: 0 }, { width: 1.5 }, { height: 20000 }, { width: 10000, height: 10000 },
    { timestampUs: Number.NaN }, { timestampUs: -1 }, { ntHandle: Buffer.alloc(4) }, { ntHandle: Buffer.alloc(8) },
  ])('rejects invalid texture metadata without sending it: %j', async (patch) => {
    const s = setup();
    await expect(s.transport.sendSdrFrame(s.target, SESSION, { ...frame('one'), ...patch })).rejects.toThrow();
    expect(s.importSharedTexture).not.toHaveBeenCalled();
    expect(s.releaseFrame).toHaveBeenCalledExactlyOnceWith('one');
  });
});
