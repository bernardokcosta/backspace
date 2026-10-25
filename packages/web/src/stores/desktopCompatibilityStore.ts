import { create } from 'zustand';
import { compareDesktopVersions, desktopCompatibilityDecision, parseMinimumDesktopVersion } from '@backspace/shared/src/desktopCompatibility';
import { isElectron } from '../platform/platform';
import { onDesktopPolicyRefused } from '../utils/desktopPolicyEvents';
import { setDesktopSessionAllowed } from '../utils/desktopSessionAccess';

export interface DesktopCompatibilityState {
  phase: 'checking' | 'allowed' | 'required' | 'failed';
  currentVersion: string | null;
  minimumVersion: string | null;
  error: string | null;
  initialize: () => () => void;
  retry: () => void;
}

const LOOKUP_TIMEOUT_MS = 8000;
const REFRESH_MS = 60_000;
let subscribers = 0;
let generation = 0;
let request: AbortController | null = null;
let cleanup: (() => void) | null = null;

export const useDesktopCompatibilityStore = create<DesktopCompatibilityState>((write, get) => {
  const set = (state: Partial<DesktopCompatibilityState>) => {
    if (state.phase) setDesktopSessionAllowed(state.phase === 'allowed');
    write(state);
  };
  async function check(): Promise<void> {
    if (!isElectron()) { set({ phase: 'allowed', minimumVersion: null, error: null }); return; }
    if (!subscribers) return;
    const previous = get();
    const revision = ++generation;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    // A normal poll must not disconnect an eligible live call every minute.
    if (previous.phase !== 'allowed' && previous.phase !== 'required') set({ phase: 'checking', error: null });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const lookup = async (): Promise<{ minimumVersion: string | null; currentVersion: string | null }> => {
        const response = await fetch('/api/instance/info', { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
        if (!response.ok) throw new Error('policy-unavailable');
        const body: unknown = await response.json();
        if (controller.signal.aborted) throw new Error('cancelled');
        if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('policy-invalid');
        const minimumVersion = parseMinimumDesktopVersion((body as Record<string, unknown>).minimumDesktopVersion);
        // A successfully disabled policy preserves older desktop behavior even
        // when its optional version bridge is unavailable.
        if (minimumVersion === null) return { minimumVersion, currentVersion: previous.currentVersion };
        let answer: unknown = null;
        try { answer = await window.backspace?.getVersion?.(); } catch { /* Unknown is not current. */ }
        const currentVersion = typeof answer === 'string' && compareDesktopVersions(answer, answer) === 0 ? answer : null;
        return { minimumVersion, currentVersion };
      };
      const result = await Promise.race([
        lookup(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('policy-timeout')); }, LOOKUP_TIMEOUT_MS); }),
      ]);
      if (revision !== generation || !subscribers) return;
      const decision = desktopCompatibilityDecision(result.currentVersion, result.minimumVersion);
      set({ ...result, phase: decision === 'allowed' ? 'allowed' : 'required', error: decision === 'unknown-version' ? 'version-unavailable' : null });
    } catch {
      if (revision !== generation || !subscribers) return;
      const knownRequired = previous.minimumVersion !== null
        && desktopCompatibilityDecision(previous.currentVersion, previous.minimumVersion) !== 'allowed';
      set({ phase: knownRequired ? 'required' : 'failed', error: 'policy-unavailable' });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (request === controller) request = null;
    }
  }

  return {
    phase: isElectron() ? 'checking' : 'allowed', currentVersion: null, minimumVersion: null, error: null,
    initialize() {
      if (!isElectron()) { set({ phase: 'allowed', minimumVersion: null, error: null }); return () => {}; }
      subscribers++;
      if (subscribers === 1) {
        const focus = () => { void check(); };
        window.addEventListener('focus', focus);
        const timer = setInterval(focus, REFRESH_MS);
        const unsubscribe = onDesktopPolicyRefused((origin) => { if (origin === '') void check(); });
        cleanup = () => { clearInterval(timer); window.removeEventListener('focus', focus); unsubscribe(); };
        void check();
      }
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        subscribers--;
        if (!subscribers) { generation++; request?.abort(); request = null; cleanup?.(); cleanup = null; }
      };
    },
    retry() { void check(); },
  };
});
