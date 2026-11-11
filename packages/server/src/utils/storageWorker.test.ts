import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { runStorageJanitor } = vi.hoisted(() => ({ runStorageJanitor: vi.fn<() => Promise<void>>() }));
vi.mock('./storageJanitor.js', () => ({ runStorageJanitor }));
let worker: typeof import('./storageWorker.js');
beforeEach(async () => { vi.useFakeTimers(); runStorageJanitor.mockReset().mockResolvedValue(); worker = await import('./storageWorker.js'); });
afterEach(() => { worker?.stopStorageWorker(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe('extracted native storage schedule', () => {
  it('waits one hour before the existing cleanup and starts only once', async () => {
    worker.startStorageWorker(); worker.startStorageWorker();
    await vi.advanceTimersByTimeAsync(3_599_999); expect(runStorageJanitor).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(runStorageJanitor).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_600_000); expect(runStorageJanitor).toHaveBeenCalledTimes(2);
  });
  it('never overlaps sweeps or rearms after stop during an in-flight sweep', async () => {
    let finish!: () => void;
    runStorageJanitor.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    worker.startStorageWorker(); await vi.advanceTimersByTimeAsync(3_600_000); expect(runStorageJanitor).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(7_200_000); expect(runStorageJanitor).toHaveBeenCalledTimes(1);
    worker.stopStorageWorker(); finish(); await vi.advanceTimersByTimeAsync(7_200_000); expect(runStorageJanitor).toHaveBeenCalledTimes(1);
  });
  it('does not let an old in-flight sweep create a second schedule after restart', async () => {
    let finish!: () => void;
    runStorageJanitor.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    worker.startStorageWorker(); await vi.advanceTimersByTimeAsync(3_600_000); worker.stopStorageWorker(); worker.startStorageWorker(); finish();
    await vi.advanceTimersByTimeAsync(3_600_000); expect(runStorageJanitor).toHaveBeenCalledTimes(2);
  });
});
