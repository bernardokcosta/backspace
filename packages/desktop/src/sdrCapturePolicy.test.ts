import { describe, expect, it } from 'vitest';
import { createSdrCaptureAuthorization, normalizeSdrCaptureConstraints, sdrCaptureCapability } from './sdrCapturePolicy';

describe('native SDR authorization', () => {
  const source = { kind: 'screen' as const, id: 'screen:1:0', displayId: '1' };

  it('grants one start to the same focused frame and navigation generation', () => {
    const authorization = createSdrCaptureAuthorization();
    const owner = {};
    authorization.grant(source, owner, 3, 1000);
    expect(authorization.consume({ owner, navigationGeneration: 3, focused: true, now: 2000 })).toEqual(source);
    expect(authorization.consume({ owner, navigationGeneration: 3, focused: true, now: 2000 })).toBeNull();
  });

  it.each([
    { now: 31_001 }, { now: 999 }, { now: Number.NaN },
    { navigationGeneration: 4 }, { focused: false }, { foreignOwner: true },
  ])('denies stale or foreign starts, consuming the grant: %j', (change) => {
    const authorization = createSdrCaptureAuthorization();
    const owner = {};
    authorization.grant(source, owner, 3, 1000);
    const request = { owner, navigationGeneration: 3, focused: true, now: 2000, ...change };
    if ('foreignOwner' in change) request.owner = {};
    expect(authorization.consume(request)).toBeNull();
    expect(authorization.consume({ owner, navigationGeneration: 3, focused: true, now: 2000 })).toBeNull();
  });

  it('accepts the exact expiry boundary and can revoke before starting', () => {
    const authorization = createSdrCaptureAuthorization();
    const owner = {};
    authorization.grant(source, owner, 3, 1000);
    expect(authorization.consume({ owner, navigationGeneration: 3, focused: true, now: 31_000 })).toEqual(source);
    authorization.grant(source, owner, 3, 1000);
    authorization.revoke();
    expect(authorization.consume({ owner, navigationGeneration: 3, focused: true, now: 1000 })).toBeNull();
  });

  it('retains a source snapshot instead of a caller-mutable selection', () => {
    const authorization = createSdrCaptureAuthorization();
    const owner = {};
    const selected = { ...source };
    authorization.grant(selected, owner, 3, 1000);
    selected.id = 'screen:other:0';
    expect(authorization.consume({ owner, navigationGeneration: 3, focused: true, now: 1000 })?.id).toBe(source.id);
  });
});

describe('native SDR constraints and capability', () => {
  it('accepts source-native or bounded requested geometry and returns only whitelisted fields', () => {
    expect(normalizeSdrCaptureConstraints({ width: 0, height: 0, frameRate: 60 })).toEqual({ width: 0, height: 0, frameRate: 60 });
    expect(normalizeSdrCaptureConstraints({ width: 1920, height: 1080, frameRate: 120, handle: 7 })).toEqual({ width: 1920, height: 1080, frameRate: 120 });
  });

  it.each([null, {}, { width: 0, height: 720, frameRate: 60 }, { width: 1920, height: 1080, frameRate: 0 },
    { width: 1920, height: 1080, frameRate: 241 }, { width: 1.5, height: 1, frameRate: 60 },
    { width: 10000, height: 10000, frameRate: 60 }, { width: 1920, height: 1080, frameRate: Number.NaN },
  ])('rejects invalid constraints: %j', (constraints) => {
    expect(normalizeSdrCaptureConstraints(constraints)).toBeNull();
  });

  it('requires Windows capture APIs, the native module and usable transport', () => {
    const available = { platform: 'win32' as NodeJS.Platform, systemVersion: '10.0.26300', moduleAvailable: true, transportAvailable: true };
    expect(sdrCaptureCapability(available)).toEqual({ supported: true });
    expect(sdrCaptureCapability({ ...available, platform: 'linux' })).toEqual({ supported: false, reason: 'platform' });
    expect(sdrCaptureCapability({ ...available, systemVersion: '10.0.17763' })).toEqual({ supported: false, reason: 'system' });
    expect(sdrCaptureCapability({ ...available, systemVersion: 'unknown' })).toEqual({ supported: false, reason: 'system' });
    expect(sdrCaptureCapability({ ...available, moduleAvailable: false })).toEqual({ supported: false, reason: 'module' });
    expect(sdrCaptureCapability({ ...available, transportAvailable: false })).toEqual({ supported: false, reason: 'transport' });
  });
});
