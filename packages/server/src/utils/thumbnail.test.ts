import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promisify } from 'node:util';

const exec = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ execFile: exec }));

beforeEach(() => {
  vi.resetModules(); exec.mockReset(); vi.useFakeTimers(); vi.setSystemTime(100_000);
  // execFile has a custom promisifier returning both streams, unlike the
  // generic callback promisifier (which resolves only stdout).
  Object.assign(exec, { [promisify.custom]: (...args: unknown[]) => new Promise((resolve, reject) => {
    exec(...args, (error: Error | null, stdout: string, stderr: string) => error ? reject(error) : resolve({ stdout, stderr }));
  }) });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function answer(error: Error | null, stdout = '') {
  exec.mockImplementationOnce((_file, _args, _options, callback) => { callback(error, stdout, ''); });
}

describe('optional media availability', () => {
  it('recovers on demand after a transient failure with one bounded probe per cooldown', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    answer(Object.assign(new Error('private path/output'), { killed: true })); answer(null);
    const { checkFfmpeg } = await import('./thumbnail.js');
    expect(await checkFfmpeg()).toBe(false);
    vi.setSystemTime(129_999); expect(await checkFfmpeg()).toBe(false); expect(exec).toHaveBeenCalledOnce();
    vi.setSystemTime(130_000); expect(await checkFfmpeg()).toBe(true); expect(exec).toHaveBeenCalledTimes(2);
    vi.setSystemTime(900_000); expect(await checkFfmpeg()).toBe(true); expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[0]?.slice(0, 3)).toEqual(['ffprobe', ['-version'], { timeout: 5000, maxBuffer: 65_536 }]);
  });

  it('coalesces simultaneous startup/upload calls and releases a rejected probe', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let complete!: (error: Error | null, stdout: string, stderr: string) => void;
    exec.mockImplementationOnce((_file, _args, _options, callback) => { complete = callback; });
    const { checkFfmpeg } = await import('./thumbnail.js');
    const calls = Array.from({ length: 10 }, () => checkFfmpeg());
    expect(exec).toHaveBeenCalledOnce(); complete(new Error('failed'), '', '');
    expect(await Promise.all(calls)).toEqual(Array(10).fill(false));
    vi.setSystemTime(130_000); answer(null); expect(await checkFfmpeg()).toBe(true);
  });

  it.each([
    [{ code: 'ENOENT' }, 'ENOENT'], [{ killed: true }, 'ETIMEDOUT'], [{ code: 1 }, undefined],
  ])('classifies %j without retaining raw exception data', async (properties, code) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    answer(Object.assign(new Error('PRIVATE_FILENAME_AND_OUTPUT'), properties));
    const { checkFfmpeg, probeMediaMeta } = await import('./thumbnail.js');
    expect(await checkFfmpeg()).toBe(false);
    expect(await probeMediaMeta('private-upload', 'audio/ogg')).toBe(null);
    expect(exec).toHaveBeenCalledOnce(); expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_FILENAME_AND_OUTPUT');
    const error = warn.mock.calls[0]?.find(value => value instanceof Error) as Error & { code?: string };
    expect(error).toBeInstanceOf(Error); expect(error.code).toBe(code);
  });

  it('does not permanently disable probes after a backwards clock jump', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    answer(new Error()); answer(new Error()); answer(null);
    const { checkFfmpeg } = await import('./thumbnail.js');
    expect(await checkFfmpeg()).toBe(false);
    vi.setSystemTime(10_000); expect(await checkFfmpeg()).toBe(false);
    expect(await checkFfmpeg()).toBe(false); expect(exec).toHaveBeenCalledTimes(2);
    vi.setSystemTime(40_000); expect(await checkFfmpeg()).toBe(true);
  });

  it('recovers through existing metadata caller and keeps later operation failures non-fatal', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    answer(new Error());
    const { probeMediaMeta } = await import('./thumbnail.js');
    expect(await probeMediaMeta('private-upload', 'audio/ogg')).toBe(null);
    vi.setSystemTime(130_000); answer(null); answer(null, '{"format":{"duration":"2.5"}}');
    expect(await probeMediaMeta('private-upload', 'audio/ogg')).toEqual({ duration: 2.5 });
    answer(new Error()); expect(await probeMediaMeta('private-upload', 'audio/ogg')).toBe(null);
  });
});
