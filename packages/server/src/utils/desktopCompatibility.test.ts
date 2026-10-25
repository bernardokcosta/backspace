import { describe, expect, it } from 'vitest';
import { compareDesktopVersions, parseMinimumDesktopVersion, identifyDesktop, desktopCompatibilityDecision } from '@backspace/shared/src/desktopCompatibility';

describe('bounded desktop SemVer contract', () => {
  it.each([
    ['1.15.10', '1.15.2', 1], ['1.15.0', '1.15.1', -1], ['1.15.1', '1.15.1', 0],
    ['1.15.1-beta.1', '1.15.1', -1], ['1.15.1+build.3', '1.15.1', 0],
    ['1.15.1-beta.10', '1.15.1-beta.2', 1], ['1.15.1-alpha', '1.15.1-alpha.1', -1],
    ['1.15.1-2', '1.15.1-alpha', -1], ['2.0.0', '1.999.999', 1],
  ])('compares %s and %s numerically', (left, right, expected) => {
    expect(compareDesktopVersions(left, right)).toBe(expected);
    expect(compareDesktopVersions(right, left)).toBe(expected === 0 ? 0 : -expected);
  });
  it.each(['', 'v1.15.1', ' 1.15.1', '1.15', '01.15.1', '1.15.1-01', '1.15.1+', '1.15.1-a..b', '9007199254740992.0.0', '1'.repeat(200)])('refuses invalid/oversized installed version %s', (value) => {
    expect(compareDesktopVersions(value, '1.15.1')).toBeNull();
    expect(desktopCompatibilityDecision(value, '1.15.1')).toBe('unknown-version');
  });
  it('accepts a missing policy but refuses malformed or prerelease floors', () => {
    expect(parseMinimumDesktopVersion(undefined)).toBeNull();
    expect(parseMinimumDesktopVersion(null)).toBeNull();
    expect(parseMinimumDesktopVersion('1.15.1')).toBe('1.15.1');
    for (const value of ['', false, 1151, '1.15.1-beta', ' 1.15.1', '1.15.1 ']) expect(() => parseMinimumDesktopVersion(value)).toThrow();
  });
  it('distinguishes disabled, old, unknown and current versions', () => {
    expect(desktopCompatibilityDecision(null, null)).toBe('allowed');
    expect(desktopCompatibilityDecision(null, '1.15.1')).toBe('unknown-version');
    expect(desktopCompatibilityDecision('1.15.0', '1.15.1')).toBe('update-required');
    expect(desktopCompatibilityDecision('1.15.1', '1.15.1')).toBe('allowed');
    expect(desktopCompatibilityDecision('1.16.0', '1.15.1')).toBe('allowed');
  });
});

describe('desktop identification is not device attestation', () => {
  it('uses only the explicit fork app-version token, never Electron version', () => {
    expect(identifyDesktop('Mozilla/5.0 Electron/45.0.0 BackspaceFork/1.15.1')).toEqual({ kind: 'desktop', version: '1.15.1' });
    expect(identifyDesktop('Mozilla/5.0 Electron/45.0.0')).toEqual({ kind: 'desktop', version: null });
    expect(identifyDesktop('Mozilla/5.0 BackspaceFork/unknown')).toEqual({ kind: 'desktop', version: null });
    expect(identifyDesktop('BackspaceFork/1.15.1 BackspaceFork/99.0.0')).toEqual({ kind: 'desktop', version: null });
  });
  it('keeps ordinary web/mobile and federation user agents outside the restriction', () => {
    for (const ua of ['', 'Mozilla/5.0 Chrome/156.0.0.0 Safari/537.36', 'Mozilla/5.0 iPhone Mobile Safari/604.1', 'Backspace-Federation/1.15.0']) {
      expect(identifyDesktop(ua)).toEqual({ kind: 'other' });
    }
  });
});
