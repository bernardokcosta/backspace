import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReadRecovery } from './readRecovery';

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('bounded session-owned read recovery', () => {
  it('deduplicates a target and retries once without blocking another target', async () => {
    const recovery = createReadRecovery(() => 'session', error => typeof error === 'number' ? error : null);
    const read = vi.fn().mockRejectedValueOnce(1).mockResolvedValue('ready');
    const first = recovery.run('one', read);
    expect(recovery.run('one', read)).toBe(first);
    await expect(recovery.run('other', async () => 'other')).resolves.toBe('other');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(first).resolves.toBe('ready');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('does not loop through repeated refusal or wait beyond the bound', async () => {
    const recovery = createReadRecovery(() => 'session', error => typeof error === 'number' ? error : null);
    const read = vi.fn().mockRejectedValue(1);
    const result = recovery.run('one', read).catch(error => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toBe(1);
    expect(read).toHaveBeenCalledTimes(2);
    await expect(recovery.run('long', async () => { throw 3600; })).rejects.toBe(3600);
  });

  it('cancels a waiting read without replay or lingering timer', async () => {
    const recovery = createReadRecovery(() => 'session', () => 1);
    const read = vi.fn().mockRejectedValue(new Error());
    const result = recovery.run('one', read).catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    recovery.cancel();
    expect(await result).toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('discards a stale in-flight result even when the transport ignores abort', async () => {
    let session = 'alice'; let complete!: (value: string) => void;
    const recovery = createReadRecovery(() => session, () => null);
    const first = recovery.run('one', () => new Promise<string>(resolve => { complete = resolve; })).catch(error => error);
    session = 'bob'; recovery.cancel();
    expect(await first).toMatchObject({ name: 'AbortError' });
    complete('private-alice');
    await expect(recovery.run('one', async () => 'bob')).resolves.toBe('bob');
  });

  it('does not retry a different session even without an explicit teardown callback', async () => {
    let session = 'alice';
    const recovery = createReadRecovery(() => session, () => 1);
    const read = vi.fn().mockRejectedValue(new Error());
    const result = recovery.run('one', read).catch(error => error);
    await vi.advanceTimersByTimeAsync(0); session = 'bob';
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(read).toHaveBeenCalledOnce();
  });
});
