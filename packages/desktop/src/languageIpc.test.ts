import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ipcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { registerLanguageIpc } from './languageIpc';

const mocks = vi.hoisted(() => ({ save: vi.fn(), languages: vi.fn(() => ['de-DE', 'en']) }));
vi.mock('electron', () => ({ app: { getPreferredSystemLanguages: mocks.languages } }));
vi.mock('./l10n', () => ({
  isDesktopLanguagePreference: (v: unknown) => ['auto', 'pt', 'en'].includes(String(v)),
  saveStoredLanguage: mocks.save,
  getSystemLanguages: mocks.languages,
}));

describe('language IPC', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.save.mockReset(); });

  function fixture() {
    const invoke = new Map<string, (event: IpcMainInvokeEvent) => unknown>();
    const send = new Map<string, (event: IpcMainEvent, value: unknown) => void>();
    const ipc = {
      handle: vi.fn((name: string, fn: (event: IpcMainInvokeEvent) => unknown) => invoke.set(name, fn)),
      on: vi.fn((name: string, fn: (event: IpcMainEvent, value: unknown) => void) => send.set(name, fn)),
    };
    const sender = {}, frame = {};
    let alive = true;
    const change = vi.fn();
    registerLanguageIpc(ipc as unknown as Pick<typeof ipcMain, 'handle' | 'on'>, event => alive && event.sender === sender && event.senderFrame === frame, change);
    return { invoke, send, change, event: { sender, senderFrame: frame } as unknown as IpcMainEvent & IpcMainInvokeEvent, destroy: () => { alive = false; } };
  }

  it('only exposes the named getter and validated preference channel', () => {
    const f = fixture();
    expect([...f.invoke.keys()]).toEqual(['get-system-languages']);
    expect([...f.send.keys()]).toEqual(['set-language']);
    expect(f.invoke.get('get-system-languages')!(f.event)).toEqual(['de-DE', 'en']);
    f.send.get('set-language')!(f.event, 'auto');
    expect(mocks.save).toHaveBeenCalledWith('auto');
    expect(f.change).toHaveBeenCalledTimes(1);
  });

  it('rejects foreign frames, windows and destroyed owners before data access', () => {
    const f = fixture();
    const bad = [{ ...f.event, sender: {} }, { ...f.event, senderFrame: {} }, { ...f.event, senderFrame: null }];
    for (const value of bad) {
      const event = value as unknown as IpcMainEvent & IpcMainInvokeEvent;
      expect(() => f.invoke.get('get-system-languages')!(event)).toThrow('sender');
      f.send.get('set-language')!(event, 'auto');
    }
    f.destroy();
    expect(() => f.invoke.get('get-system-languages')!(f.event)).toThrow('sender');
    f.send.get('set-language')!(f.event, 'auto');
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.languages).not.toHaveBeenCalled();
  });

  it('does not accept arbitrary values and refreshes UI despite a disk failure', () => {
    const f = fixture();
    for (const value of [null, {}, 12, 'zz', 'pt-BR']) f.send.get('set-language')!(f.event, value);
    expect(mocks.save).not.toHaveBeenCalled();
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.save.mockImplementation(() => { throw Error('disk denied'); });
    f.send.get('set-language')!(f.event, 'pt');
    expect(f.change).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
