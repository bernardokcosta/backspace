import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ipcMain, IpcMainInvokeEvent } from 'electron';
import { pathToFileURL } from 'node:url';
import { getPickerPath, loadInstanceUrl, registerInstanceUrlIpc } from './instanceUrl';

const files = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), unlink: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => '/isolated-profile' } }));
vi.mock('fs', () => ({ default: { readFileSync: files.read, writeFileSync: files.write, unlinkSync: files.unlink } }));

beforeEach(() => { vi.resetAllMocks(); files.read.mockReturnValue(JSON.stringify({ url: 'https://current.invalid' })); });

function fixture() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, value?: unknown) => unknown>();
  const ipc = { handle: vi.fn((name: string, handler: (event: IpcMainInvokeEvent, value?: unknown) => unknown) => handlers.set(name, handler)) };
  const sender = {}, frame = { url: pathToFileURL(getPickerPath()).href + '?lang=pt' };
  let alive = true;
  const navigate = vi.fn();
  registerInstanceUrlIpc(ipc as unknown as Pick<typeof ipcMain, 'handle'>,
    event => alive && event.sender === sender && event.senderFrame === frame, navigate);
  const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  return { handlers, event, frame, navigate, destroy: () => { alive = false; } };
}

describe('native instance selection IPC', () => {
  it('keeps first-run, picker cancel and explicit Change Instance on the existing channels', () => {
    const f = fixture();
    expect([...f.handlers.keys()]).toEqual(['get-instance-url', 'set-instance-url', 'clear-instance-url']);
    expect(f.handlers.get('get-instance-url')!(f.event)).toBe('https://current.invalid');
    f.handlers.get('set-instance-url')!(f.event, 'http://localhost:5173');
    expect(files.write).toHaveBeenLastCalledWith(expect.stringContaining('instance-url.json'), JSON.stringify({ url: 'http://localhost:5173' }));
    expect(f.navigate).toHaveBeenLastCalledWith('http://localhost:5173');
    f.frame.url = 'https://current.invalid/settings';
    f.handlers.get('clear-instance-url')!(f.event);
    expect(files.unlink).toHaveBeenCalledTimes(1);
    expect(f.navigate).toHaveBeenLastCalledWith(null);
  });

  it('rejects other windows, child/missing frames and destroyed owners before all profile I/O', () => {
    const f = fixture();
    for (const bad of [{ ...f.event, sender: {} }, { ...f.event, senderFrame: {} }, { ...f.event, senderFrame: null }]) {
      for (const handler of f.handlers.values()) expect(() => handler(bad as IpcMainInvokeEvent, 'https://new.invalid')).toThrow(/sender/i);
    }
    f.destroy();
    for (const handler of f.handlers.values()) expect(() => handler(f.event, 'https://new.invalid')).toThrow(/sender/i);
    expect(files.read).not.toHaveBeenCalled(); expect(files.write).not.toHaveBeenCalled(); expect(files.unlink).not.toHaveBeenCalled();
    expect(f.navigate).not.toHaveBeenCalled();
  });

  it('only the bundled picker can replace the server, not remote page code or another local HTML file', () => {
    const f = fixture();
    for (const url of ['https://current.invalid', 'https://foreign.invalid', 'file:///untrusted.html', 'about:blank']) {
      f.frame.url = url;
      expect(() => f.handlers.get('set-instance-url')!(f.event, 'https://new.invalid')).toThrow(/picker/i);
    }
    expect(files.write).not.toHaveBeenCalled(); expect(f.navigate).not.toHaveBeenCalled();
  });

  it('refuses malformed, non-web and credential-bearing targets before persistence or navigation', () => {
    const f = fixture();
    for (const value of [null, {}, 42, '', '//example.com', 'file:///secret', 'javascript:alert(1)', 'data:text/html,x',
      'https://u:p@example.com', 'https://u@example.com', 'https://example.com\n.evil', 'https://']) {
      expect(() => f.handlers.get('set-instance-url')!(f.event, value)).toThrow(/URL/i);
    }
    expect(files.write).not.toHaveBeenCalled(); expect(f.navigate).not.toHaveBeenCalled();
  });

  it('does not navigate when saving a valid choice fails', () => {
    const f = fixture(); files.write.mockImplementation(() => { throw new Error('profile denied'); });
    expect(() => f.handlers.get('set-instance-url')!(f.event, 'https://new.invalid')).toThrow('profile denied');
    expect(f.navigate).not.toHaveBeenCalled();
  });
});

describe('saved instance URL admission', () => {
  it('retains safe native URLs and fails closed on an unsafe/malformed saved preference without deleting it', () => {
    for (const url of ['https://server.invalid', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
      files.read.mockReturnValue(JSON.stringify({ url })); expect(loadInstanceUrl()).toBe(url);
    }
    for (const url of ['file:///secret', 'https://u:p@server.invalid', null, {}]) {
      files.read.mockReturnValue(JSON.stringify({ url })); expect(loadInstanceUrl()).toBeNull();
    }
    files.read.mockReturnValue('{'); expect(loadInstanceUrl()).toBeNull();
    expect(files.write).not.toHaveBeenCalled(); expect(files.unlink).not.toHaveBeenCalled();
  });
});
