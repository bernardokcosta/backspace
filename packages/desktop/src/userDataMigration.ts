import fs from 'fs';
import path from 'path';

export type MigrationResult =
  | { kind: 'no-op'; reason: 'old-missing' | 'new-populated' | 'identical' }
  | { kind: 'migrated'; from: string; to: string }
  | { kind: 'failed'; error: Error };

export interface MigrationOptions {
  oldDir: string;
  newDir: string;
  oldParent: string;
}

function dirExists(dir: string): boolean {
  try {
    if (!fs.statSync(dir).isDirectory()) throw new Error('Profile path is not a directory');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function isEmpty(dir: string): boolean {
  return fs.readdirSync(dir).length === 0;
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else if (entry.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(s), d);
    } else {
      fs.copyFileSync(s, d, fs.constants.COPYFILE_EXCL);
    }
  }
}

export function migrateUserData(opts: MigrationOptions): MigrationResult {
  const { oldDir, newDir, oldParent } = opts;

  try {
    if (path.resolve(oldDir) === path.resolve(newDir)) {
      return { kind: 'no-op', reason: 'identical' };
    }
    const destinationExists = dirExists(newDir);
    if (destinationExists) {
      if (!isEmpty(newDir)) {
        return { kind: 'no-op', reason: 'new-populated' };
      }
    }
    if (!dirExists(oldDir)) {
      return { kind: 'no-op', reason: 'old-missing' };
    }
    // A stat-able but unreadable directory is not a safe profile to move.
    fs.readdirSync(oldDir);
    if (destinationExists) {
      fs.rmdirSync(newDir);
    }

    fs.mkdirSync(path.dirname(newDir), { recursive: true });

    try {
      fs.renameSync(oldDir, newDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      // Never expose a partial copy as a usable profile. Staging is exclusively
      // owned by this invocation and promotion stays on the destination volume.
      const staging = fs.mkdtempSync(`${newDir}.migrating-`);
      try {
        copyDirRecursive(oldDir, staging);
        if (dirExists(newDir)) throw new Error('Profile destination appeared during migration');
        fs.renameSync(staging, newDir);
      } catch (copyError) {
        try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* A leftover staging directory is never selected as userData. */ }
        throw copyError;
      }
      // Keep the cross-device original as a safety copy. The committed,
      // populated destination wins on every subsequent startup; never merge.
    }

    try {
      fs.rmdirSync(oldParent);
    } catch {
      // Parent has other children, or doesn't exist — both fine.
    }

    return { kind: 'migrated', from: oldDir, to: newDir };
  } catch (err) {
    return { kind: 'failed', error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/** Keep runtime crypto/profile identity separate from the public product name. */
export function initializeUserData(app: {
  setName(name: string): void;
  getPath(name: 'appData'): string;
}): MigrationResult {
  try {
    app.setName('Backspace Fork');
    const appDataDir = app.getPath('appData');
    const oldParent = path.join(appDataDir, '@backspace');
    return migrateUserData({
      oldDir: path.join(oldParent, 'desktop'),
      newDir: path.join(appDataDir, 'Backspace Fork'),
      oldParent,
    });
  } catch (error) {
    return { kind: 'failed', error: error instanceof Error ? error : new Error(String(error)) };
  }
}
