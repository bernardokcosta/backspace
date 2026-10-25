import { describe, expect, it } from 'vitest';
import { desktopUserAgent } from './desktopUserAgent';
describe('explicit installed desktop identity', () => {
  it('preserves browser/Electron tokens and adds the app version exactly once', () => {
    const ua = 'Mozilla/5.0 Backspace-Fork/1.15.0 Chrome/156.0 Electron/45.0 Safari/537.36';
    const identified = desktopUserAgent(ua, '1.15.1');
    expect(identified).toBe(`${ua} BackspaceFork/1.15.1`);
    expect(desktopUserAgent(identified, '1.15.2')).toBe(`${ua} BackspaceFork/1.15.2`);
  });
  it('does not interpolate unsafe bridge/header values', () => {
    expect(desktopUserAgent('Mozilla/5.0', 'bad\r\nInjected: x')).toBe('Mozilla/5.0 BackspaceFork/unknown');
  });
});
