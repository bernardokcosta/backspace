import { afterEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { useInterfaceScaleStore } from '../stores/interfaceScaleStore';
import { JUNO_PREFERENCES_KEY, useJunoPreferences } from '../stores/junoPreferences';
import { LANGUAGE_STORAGE_KEY } from '../i18n/languages';
import { putHandle, getHandle, clearAllHandles } from '../utils/idbHandles';

afterEach(async () => { localStorage.clear(); await clearAllHandles(); });
describe('rebrand leaves browser storage identity in place', () => {
  it('rehydrates old device settings twice without creating competing Veyvox keys', async () => {
    localStorage.setItem('backspace_token', 'synthetic-session');
    localStorage.setItem('backspace-language', 'auto');
    localStorage.setItem('backspace_instances_synthetic-owner', '[{"origin":"https://peer.example","token":"synthetic-peer"}]');
    localStorage.setItem('backspace-interface-scale', JSON.stringify({ state: { scale: 200 }, version: 0 }));
    localStorage.setItem(JUNO_PREFERENCES_KEY, JSON.stringify({ state: { language: 'pt', dubbingLanguage: 'auto', effectsVolume: 35, musicVolume: 20 }, version: 0 }));
    const handle = { kind: 'file', name: 'synthetic-pending-upload' } as unknown as FileSystemHandle;
    await putHandle('rebrand-pending', handle);
    for (let launch = 0; launch < 2; launch++) {
      await useInterfaceScaleStore.persist.rehydrate(); await useJunoPreferences.persist.rehydrate();
      expect(useInterfaceScaleStore.getState().scale).toBe(200);
      expect(useJunoPreferences.getState()).toMatchObject({ language: 'pt', dubbingLanguage: 'auto', effectsVolume: 35, musicVolume: 20 });
      expect(await getHandle('rebrand-pending')).toEqual(handle);
      expect(localStorage.getItem('backspace_token')).toBe('synthetic-session');
      expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('auto');
      expect(localStorage.getItem('backspace_instances_synthetic-owner')).toContain('synthetic-peer');
    }
    expect(Object.keys(localStorage).filter(key => key.startsWith('veyvox'))).toEqual([]);
  });
});
