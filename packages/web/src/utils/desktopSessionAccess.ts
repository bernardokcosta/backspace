import { isElectron } from '../platform/platform';

// Synchronous seam shared by API, WS and transfers. No store imports:
// rejection takes effect before React unmount/lazy async callbacks run.
let allowed = !isElectron();
let revision = 0;
let controller = new AbortController();
const listeners = new Set<(allowed: boolean) => void>();

export function isDesktopSessionAllowed(): boolean { return allowed; }
export function setDesktopSessionAllowed(value: boolean): void {
  if (value === allowed) return;
  allowed = value;
  revision++;
  if (!value) controller.abort();
  else controller = new AbortController();
  for (const listener of listeners) listener(value);
}
export function onDesktopSessionAccessChanged(listener: (allowed: boolean) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function captureDesktopSessionWork() {
  const startedAt = revision;
  const isCurrent = () => allowed && revision === startedAt;
  return {
    signal: controller.signal,
    isCurrent,
    assertCurrent() { if (!isCurrent()) throw new DOMException('Desktop compatibility not confirmed', 'AbortError'); },
  };
}
