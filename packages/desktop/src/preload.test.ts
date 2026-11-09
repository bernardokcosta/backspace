import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ expose: vi.fn(), send: vi.fn(), invoke: vi.fn().mockResolvedValue(undefined), on: vi.fn(), remove: vi.fn() }));
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: { send: mocks.send, invoke: mocks.invoke, on: mocks.on, removeListener: mocks.remove }, sharedTexture: {} }));

describe('one bounded preload implementation', () => {
  it('exposes both names with the same operations and original IPC contracts', async () => {
    await import('./preload');
    const canonical = mocks.expose.mock.calls.find(([name]) => name === 'veyvox')?.[1] as {
      minimize(): void; rendererReady(): void; onNotificationClick(callback: () => void): () => void;
    } | undefined;
    const legacy = mocks.expose.mock.calls.find(([name]) => name === 'backspace')?.[1];
    expect(canonical).toBeDefined();
    expect(canonical).toBe(legacy); // Same privileged object BEFORE crossing contextBridge.
    expect(Object.keys(canonical ?? {})).not.toContain('send');
    canonical?.minimize(); canonical?.rendererReady();
    expect(mocks.send).toHaveBeenCalledWith('minimize-window');
    expect(mocks.send).toHaveBeenCalledWith('renderer-ready');
    const callback = vi.fn();
    const off = canonical?.onNotificationClick(callback);
    const registration = mocks.on.mock.calls.find(([name]) => name === 'notification-click');
    expect(registration).toBeDefined(); off?.();
    expect(mocks.remove).toHaveBeenCalledWith('notification-click', registration?.[1]);
  });
});
