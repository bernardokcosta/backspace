import type { ipcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { getSystemLanguages, isDesktopLanguagePreference, saveStoredLanguage } from './l10n';

/** Language-only IPC; main supplies the same live-window/main-frame guard as capture. */
export function registerLanguageIpc(
  ipc: Pick<typeof ipcMain, 'handle' | 'on'>,
  isSenderAllowed: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean,
  onChange: () => void,
): void {
  ipc.handle('get-system-languages', event => {
    if (!isSenderAllowed(event)) throw new Error('Language sender/frame is not authorized');
    return [...getSystemLanguages()];
  });
  ipc.on('set-language', (event, preference: unknown) => {
    if (!isSenderAllowed(event) || !isDesktopLanguagePreference(preference)) return;
    try {
      saveStoredLanguage(preference);
    } catch (error) {
      console.warn('[main] Failed to persist language:', error);
    }
    onChange();
  });
}
