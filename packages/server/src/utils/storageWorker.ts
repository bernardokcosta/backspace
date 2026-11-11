import { runStorageJanitor } from './storageJanitor.js';

const INTERVAL_MS = 3_600_000;
let timer: ReturnType<typeof setTimeout> | null = null;
// A lifecycle token prevents an old in-flight sweep from rearming after restart.
let lifecycle: object | null = null;
function schedule(token: object): void {
  timer = setTimeout(() => {
    timer = null;
    void runStorageJanitor().catch(error => {
      console.error('[storage-janitor] Scheduled cleanup failed:', error);
    }).finally(() => { if (lifecycle === token) schedule(token); });
  }, INTERVAL_MS);
  timer.unref();
}
export function startStorageWorker(): void {
  if (lifecycle !== null) return;
  lifecycle = {}; schedule(lifecycle);
}
export function stopStorageWorker(): void {
  lifecycle = null;
  if (timer !== null) { clearTimeout(timer); timer = null; }
}
