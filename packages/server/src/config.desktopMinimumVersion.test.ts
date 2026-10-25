import { afterEach, describe, expect, it, vi } from 'vitest';
const saved = process.env.BACKSPACE_MIN_DESKTOP_VERSION;
afterEach(() => {
  if (saved === undefined) delete process.env.BACKSPACE_MIN_DESKTOP_VERSION;
  else process.env.BACKSPACE_MIN_DESKTOP_VERSION = saved;
});
async function read(value?: string) {
  if (value === undefined) delete process.env.BACKSPACE_MIN_DESKTOP_VERSION;
  else process.env.BACKSPACE_MIN_DESKTOP_VERSION = value;
  vi.resetModules();
  return (await import('./config.js')).config.minimumDesktopVersion;
}
describe('BACKSPACE_MIN_DESKTOP_VERSION', () => {
  it('is disabled by default and for blank environment values', async () => {
    for (const value of [undefined, '', '   ']) expect(await read(value)).toBeNull();
  });
  it('trims environment values and exposes a stable version', async () => {
    expect(await read(' 1.15.1 ')).toBe('1.15.1');
  });
  it.each(['1.15', 'v1.15.1', '1.15.1-beta.1', '1.15.01'])('fails startup on malformed minimum %s', async (value) => {
    await expect(read(value)).rejects.toThrow(/minimum|version|SemVer/i);
  });
});
