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
  return (await import('./config.js')).config;
}
describe('retired BACKSPACE_MIN_DESKTOP_VERSION', () => {
  it.each([undefined, '', '   ', '1.15.1', '1.15', 'v1.15.1', '1.15.1-beta.1', '1.15.01'])('ignores legacy setting %s without blocking startup', async (value) => {
    expect(await read(value)).not.toHaveProperty('minimumDesktopVersion');
  });
});
