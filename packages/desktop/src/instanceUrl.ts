import { app } from 'electron';
import type { ipcMain, IpcMainInvokeEvent } from 'electron';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

function validatedInstanceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null;
    return url.href.replace(/\/$/, '');
  } catch { return null; }
}

export function getInstanceUrlPath(): string {
  return path.join(app.getPath('userData'), 'instance-url.json');
}

export function loadInstanceUrl(): string | null {
  try {
    const data = JSON.parse(fs.readFileSync(getInstanceUrlPath(), 'utf-8'));
    return validatedInstanceUrl(data.url);
  } catch {
    return null;
  }
}

export function saveInstanceUrl(url: string): void {
  const validated = validatedInstanceUrl(url);
  if (validated === null) throw new Error('Invalid instance URL');
  fs.writeFileSync(getInstanceUrlPath(), JSON.stringify({ url: validated }));
}

export function clearInstanceUrl(): void {
  try {
    fs.unlinkSync(getInstanceUrlPath());
  } catch {
    // File may not exist — ignore
  }
}

export function getPickerPath(): string {
  return path.join(__dirname, '..', 'resources', 'instance-picker.html');
}

/** Same live-window/main-frame guard as language IPC; selection is picker-only. */
export function registerInstanceUrlIpc(
  ipc: Pick<typeof ipcMain, 'handle'>,
  isSenderAllowed: (event: IpcMainInvokeEvent) => boolean,
  onNavigate: (url: string | null) => void,
): void {
  function requireSender(event: IpcMainInvokeEvent): void {
    if (!isSenderAllowed(event)) throw new Error('Instance sender/frame is not authorized');
  }
  ipc.handle('get-instance-url', event => {
    requireSender(event);
    return loadInstanceUrl();
  });
  ipc.handle('set-instance-url', (event, value: unknown) => {
    requireSender(event);
    let picker = false;
    try {
      const url = new URL(event.senderFrame?.url ?? '');
      url.search = ''; url.hash = '';
      picker = url.href === pathToFileURL(getPickerPath()).href;
    } catch { /* Missing/unknown frame URL is never the bundled picker. */ }
    if (!picker) throw new Error('Instance selection requires the bundled picker');
    const url = validatedInstanceUrl(value);
    if (url === null) throw new Error('Invalid instance URL');
    saveInstanceUrl(url);
    onNavigate(url);
  });
  ipc.handle('clear-instance-url', event => {
    requireSender(event);
    clearInstanceUrl();
    onNavigate(null);
  });
}
