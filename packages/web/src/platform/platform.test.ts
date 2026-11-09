import { afterEach, describe, expect, it, vi } from 'vitest';
import { getElectronAPI, isElectron, isElectronMac } from './platform';

afterEach(() => { vi.unstubAllGlobals(); delete window.veyvox; delete window.backspace; });
describe('desktop bridge compatibility', () => {
  it('prefers Veyvox and retains old-shell fallback without requiring optional methods', () => {
    const legacy = { platform: 'win32', rendererReady: vi.fn() } as BackspaceElectronAPI;
    const canonical = { platform: 'darwin', rendererReady: vi.fn() } as BackspaceElectronAPI;
    window.backspace = legacy;
    expect(getElectronAPI()).toBe(legacy);
    expect(isElectron()).toBe(true);
    window.veyvox = canonical;
    expect(getElectronAPI()).toBe(canonical);
    expect(isElectronMac()).toBe(true);
    getElectronAPI()?.rendererReady();
    expect(canonical.rendererReady).toHaveBeenCalledOnce();
    expect(legacy.rendererReady).not.toHaveBeenCalled();
    delete window.veyvox;
    expect(getElectronAPI()).toBe(legacy);
  });
  it('returns a browser result when neither bridge or window exists', () => {
    delete window.backspace;
    expect(getElectronAPI()).toBeNull();
    expect(isElectron()).toBe(false);
    vi.stubGlobal('window', undefined);
    expect(getElectronAPI()).toBeNull();
    expect(isElectronMac()).toBe(false);
  });
});
