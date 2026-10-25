const listeners = new Set<(origin: string) => void>();

export function onDesktopPolicyRefused(listener: (origin: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Refusal is origin-scoped, never a peer-selected global minimum or updater URL. */
export function noteDesktopPolicyRefused(origin: string): void {
  let normalized = origin;
  if (origin !== '') {
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) return;
      if (typeof window !== 'undefined' && origin === window.location.origin) normalized = '';
    } catch { return; }
  }
  for (const listener of listeners) {
    try { listener(normalized); } catch { /* Teardown of one subscriber must not mask a refusal. */ }
  }
}
