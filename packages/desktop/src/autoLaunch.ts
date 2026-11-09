/**
 * Whether a login-item arg list asks for a hidden launch (`--hidden`).
 *
 * Note: this is write-path only now. main.ts used to read it back from
 * `launchItems[].args` on Windows, but Electron never parses `args` back
 * there (verified on Electron 45: always `[]`), so the registry entry's
 * `--hidden` is write-only and the disk cache is the source of truth.
 * Kept (and tested) as the one definition of the flag's spelling.
 */
export function deriveStartMinimizedFromArgs(args: string[] | undefined): boolean {
  if (!args) return false;
  return args.includes('--hidden');
}

/**
 * Extracts the executable path from a freedesktop .desktop file's Exec= line.
 * Handles double-quoted paths (which may contain spaces). Ignores commented
 * lines (leading #). Returns null if no Exec= line is present or parseable.
 *
 * Decode the two escaping layers used by our writer; never execute this token.
 */
export function parseExecPathFromDesktopFile(content: string): string | null {
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (!line.startsWith('Exec=')) continue;
    const value = line.slice('Exec='.length).replace(/\\([\\strn])/g, (_match, escaped: string) => ({ '\\': '\\', s: ' ', t: '\t', r: '\r', n: '\n' })[escaped] ?? escaped);
    if (!value) continue;
    if (value.startsWith('"')) {
      const match = /^"((?:\\.|[^"\\])*)"(?:\s|$)/.exec(value);
      if (!match) return null;
      const extracted = match[1]!.replace(/\\(["`$\\])/g, '$1').replaceAll('%%', '%');
      return extracted === '' ? null : extracted;
    }
    const sp = value.indexOf(' ');
    return sp === -1 ? value : value.slice(0, sp);
  }
  return null;
}

/**
 * Returns true iff the existing autostart entry's recorded executable path differs
 * from the current AppImage path (i.e., the AppImage moved and the entry is stale).
 *
 * A missing recorded path (recordedExecPath === null, i.e. the .desktop file does
 * not exist) is intentionally treated as "do nothing" — it represents the user
 * disabling autostart via their desktop environment's startup manager or removing
 * the file manually. Re-creating it would override OS-level user intent, which is
 * exactly the bug class this whole refactor exists to fix.
 */
export function shouldReapplyAppImage(
  currentAppImagePath: string | null,
  recordedExecPath: string | null,
): boolean {
  if (!currentAppImagePath) return false;
  if (!recordedExecPath) return false;
  return currentAppImagePath !== recordedExecPath;
}

/** Refresh only this fork's enabled legacy entry, never an unrelated command. */
export function shouldRefreshLinuxAutoLaunch(currentPath: string, entry: string | null): boolean {
  if (!linuxAutoLaunchEnabled(entry)) return false;
  const recordedPath = parseExecPathFromDesktopFile(entry!);
  if (!shouldReapplyAppImage(currentPath, recordedPath)) return false;
  if (currentPath === '/opt/Veyvox/Backspace Fork' && recordedPath === '/opt/Backspace Fork/Backspace Fork') return true;
  const brandedAppImage = /(?:^|\/)(?:Veyvox|Backspace[ -]Fork)(?:[- .][^/]*)?\.AppImage$/;
  return brandedAppImage.test(currentPath) && brandedAppImage.test(recordedPath ?? '');
}

export function linuxAutoLaunchEnabled(entry: string | null): boolean {
  return entry !== null && !/^\s*(?:Hidden\s*=\s*true|X-GNOME-Autostart-enabled\s*=\s*false)\s*$/mi.test(entry)
    && parseExecPathFromDesktopFile(entry) !== null;
}

/** Electron 45's Linux login-item implementation is a no-op. Own only the
 * existing backspace-fork.desktop file; explicit toggles and guarded refresh
 * share this writer, not a second startup mechanism.
 */
export function linuxAutoLaunchEntry(executable: string, startMinimized: boolean): string {
  if (!executable.startsWith('/') || /[\u0000-\u001f\u007f]/.test(executable)) throw new Error('Invalid autostart executable');
  const quoted = `"${executable.replaceAll('%', '%%').replace(/["`$\\]/g, '\\$&')}"`.replaceAll('\\', '\\\\');
  return `[Desktop Entry]\nType=Application\nName=Veyvox\nExec=${quoted}${startMinimized ? ' --hidden' : ''}\nX-GNOME-Autostart-enabled=true\n`;
}
