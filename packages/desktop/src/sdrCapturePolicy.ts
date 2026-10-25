import type { AuthorizedSdrSource, SdrCaptureCapability, SdrCaptureConstraints } from './sdrCaptureTypes';

const GRANT_TTL_MS = 30_000;

interface CaptureGrant<T extends AuthorizedSdrSource> {
  source: T;
  owner: object;
  navigationGeneration: number;
  at: number;
}

/** Authorizes acquisition, not each frame: a legitimate live share survives alt-tab. */
export function createSdrCaptureAuthorization<T extends AuthorizedSdrSource = AuthorizedSdrSource>(): {
  grant: (source: T, owner: object, navigationGeneration: number, now: number) => void;
  consume: (request: { owner: object; navigationGeneration: number; focused: boolean; now: number }) => T | null;
  revoke: () => void;
} {
  let pending: CaptureGrant<T> | null = null;
  return {
    grant(source, owner, navigationGeneration, now) {
      pending = { source: { ...source }, owner, navigationGeneration, at: now };
    },
    consume(request) {
      const candidate = pending;
      pending = null;
      if (!candidate || !request.focused || candidate.owner !== request.owner
          || candidate.navigationGeneration !== request.navigationGeneration
          || !Number.isFinite(request.now) || !Number.isFinite(candidate.at)) return null;
      const age = request.now - candidate.at;
      return age >= 0 && age <= GRANT_TTL_MS ? candidate.source : null;
    },
    revoke() { pending = null; },
  };
}

export function normalizeSdrCaptureConstraints(value: unknown): SdrCaptureConstraints | null {
  if (typeof value !== 'object' || value === null) return null;
  const { width, height, frameRate } = value as Record<string, unknown>;
  if (typeof width !== 'number' || typeof height !== 'number' || typeof frameRate !== 'number'
      || !Number.isInteger(width) || !Number.isInteger(height) || !Number.isInteger(frameRate)
      || width < 0 || height < 0 || width > 16384 || height > 16384 || width * height > 33_554_432
      || (width === 0) !== (height === 0) || frameRate < 1 || frameRate > 240) return null;
  return { width, height, frameRate };
}

export function sdrCaptureCapability(input: {
  platform: NodeJS.Platform;
  systemVersion: string;
  moduleAvailable: boolean;
  transportAvailable: boolean;
}): SdrCaptureCapability {
  if (input.platform !== 'win32') return { supported: false, reason: 'platform' };
  const version = /^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?$/.exec(input.systemVersion);
  if (!version || Number(version[1]) < 10 || Number(version[3]) < 18362) return { supported: false, reason: 'system' };
  if (!input.moduleAvailable) return { supported: false, reason: 'module' };
  if (!input.transportAvailable) return { supported: false, reason: 'transport' };
  return { supported: true };
}
