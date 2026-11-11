import { afterEach, describe, expect, it, vi } from 'vitest';
import { retireFederationStorage } from './retireFederationStorage';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const entries = (): Record<string, string> => Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
  const key = localStorage.key(index)!; return [key, localStorage.getItem(key)!];
}));
describe('isolated retirement of persisted peer credentials', () => {
  it('removes every adjacent retired key without parsing malformed values, and is idempotent', () => {
    for (const key of ['backspace_instances', 'backspace_instances_alice', 'backspace_instances_bob',
      'backspace_true_home_status:home:alice', 'backspace_true_home_status:home:bob', 'backspace_true_home_status:']) localStorage.setItem(key, '{malformed');
    retireFederationStorage(localStorage); expect(entries()).toEqual({});
    retireFederationStorage(localStorage); expect(entries()).toEqual({});
  });
  it('preserves lookalikes, native session/settings/drafts/current URL and pending transfer values byte for byte', () => {
    const native = {
      backspace_token: 'synthetic-session', 'backspace-language': 'pt', 'backspace-interface-scale': '{"state":{"scale":125},"version":0}',
      backspace_url: 'https://selected.invalid:8443', backspace_voice: '{"microphone":"synthetic-device"}',
      backspace_transfers: '[{"id":"pending-native","state":"paused"}]', backspace_drafts: '{"local-dm":"draft"}',
      backspace_instances_: 'empty suffix is not an account', backspace_instancesBackup: 'not a retired key',
      backspace_true_home_status: 'not scoped', backspace_true_home_statusBackup: 'not a report',
    };
    for (const [key, value] of Object.entries(native)) localStorage.setItem(key, value);
    localStorage.setItem('backspace_instances_native', '[{"origin":"https://unused.invalid","token":"synthetic-peer"}]');
    retireFederationStorage(localStorage); expect(entries()).toEqual(native);
  });
  it('tolerates denied enumeration without reading values or clearing unrelated storage', () => {
    const blocked = { get length() { throw new DOMException('blocked', 'SecurityError'); }, getItem: vi.fn(), clear: vi.fn() } as unknown as Storage;
    expect(() => retireFederationStorage(blocked)).not.toThrow();
    expect(blocked.getItem).not.toHaveBeenCalled(); expect(blocked.clear).not.toHaveBeenCalled();
  });
  it('continues after one key refuses removal, without adopting any old credential', () => {
    localStorage.setItem('backspace_instances_a', 'a'); localStorage.setItem('backspace_instances_b', 'b');
    const original = localStorage.removeItem.bind(localStorage);
    vi.spyOn(localStorage, 'removeItem').mockImplementation(key => { if (key.endsWith('_a')) throw new Error('synthetic denial'); original(key); });
    retireFederationStorage(localStorage); expect(entries()).toEqual({ backspace_instances_a: 'a' });
  });
  it('runs before application imports, and denied storage at bootstrap does not prevent the module from loading', async () => {
    const sources = import.meta.glob('../main.tsx', { query: '?raw', import: 'default', eager: true });
    expect(Object.values(sources)[0]).toMatch(/^import ['"]\.\/platform\/retireFederationStorage['"]/);
    vi.resetModules();
    vi.stubGlobal('localStorage', { get length() { throw new DOMException('blocked', 'SecurityError'); } });
    await expect(import('./retireFederationStorage')).resolves.toHaveProperty('retireFederationStorage');
    vi.unstubAllGlobals();
  });
});
