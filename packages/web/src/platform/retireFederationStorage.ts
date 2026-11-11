/** Remove only obsolete peer credentials; never inspect or adopt their values. */
export function retireFederationStorage(storage: Storage): void {
  const keys: string[] = [];
  try {
    // Snapshot before mutation: indexed Storage enumeration shifts on removal.
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key !== null && (key === 'backspace_instances'
          || (key.startsWith('backspace_instances_') && key.length > 'backspace_instances_'.length)
          || key.startsWith('backspace_true_home_status:'))) keys.push(key);
    }
  } catch { return; }
  for (const key of keys) {
    try { storage.removeItem(key); } catch { /* A denied key never becomes a session. */ }
  }
}

// First import in main.tsx, before any auth/socket/store module is evaluated.
try { retireFederationStorage(localStorage); } catch { /* Storage may be unavailable. */ }
