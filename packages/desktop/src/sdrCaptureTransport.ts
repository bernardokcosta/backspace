import type { SharedTexture, SharedTextureImported, WebFrameMain } from 'electron';
import type { NativeSdrFrame } from './sdrCaptureTypes';

interface TransportDependencies {
  api: Pick<SharedTexture, 'importSharedTexture' | 'sendSharedTexture'>;
  isTargetAllowed: (target: WebFrameMain) => boolean;
  releaseFrame: (frameId: string) => void;
}

const MAX_RETAINED_FRAMES = 3;
const MAX_PIXELS = 33_554_432;

function validFrame(frame: NativeSdrFrame): boolean {
  return typeof frame.frameId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(frame.frameId)
    && Number.isInteger(frame.width) && frame.width > 0 && frame.width <= 16384
    && Number.isInteger(frame.height) && frame.height > 0 && frame.height <= 16384
    && frame.width * frame.height <= MAX_PIXELS
    && Number.isSafeInteger(frame.timestampUs) && frame.timestampUs >= 0
    && Buffer.isBuffer(frame.ntHandle) && frame.ntHandle.length === 8
    && frame.ntHandle.readBigUInt64LE() !== 0n && frame.ntHandle.readBigUInt64LE() !== 0xffffffffffffffffn;
}

/** One instance owns the process-wide native output pool, including retired sessions. */
export function createSdrCaptureTransport(dependencies: TransportDependencies): {
  sendSdrFrame: (target: WebFrameMain, sessionId: string, frame: NativeSdrFrame) => Promise<void>;
} {
  const retained = new Set<string>();

  return {
    async sendSdrFrame(target, sessionId, frame) {
      // A duplicate is already owned by the first import: rejecting it must not
      // free storage which the GPU may still be reading.
      if (retained.has(frame.frameId)) throw new Error('SDR duplicate frame');
      let released = false;
      const releaseNative = (): void => {
        if (released) return;
        released = true;
        retained.delete(frame.frameId);
        dependencies.releaseFrame(frame.frameId);
      };

      let imported: SharedTextureImported | undefined;
      try {
        if (!dependencies.isTargetAllowed(target) || target.isDestroyed()) throw new Error('SDR target is not authorized');
        if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 64 || !validFrame(frame)) {
          throw new Error('SDR invalid texture metadata');
        }
        if (retained.size >= MAX_RETAINED_FRAMES) throw new Error('SDR frame capacity exceeded');
        retained.add(frame.frameId);
        imported = dependencies.api.importSharedTexture({
          textureInfo: {
            pixelFormat: 'bgra',
            colorSpace: { primaries: 'bt709', transfer: 'srgb', matrix: 'rgb', range: 'full' },
            codedSize: { width: frame.width, height: frame.height },
            timestamp: frame.timestampUs,
            handle: { ntHandle: frame.ntHandle },
          },
          allReferencesReleased: releaseNative,
        });
        await dependencies.api.sendSharedTexture({ frame: target, importedSharedTexture: imported }, { sessionId });
      } finally {
        if (imported) {
          // A send failure may still have created remote/GPU references. Only
          // Electron's managed release callback may release native storage.
          imported.release();
        } else {
          releaseNative();
        }
      }
    },
  };
}
