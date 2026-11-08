import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_JUNO_PREFERENCES, JUNO_PREFERENCES_KEY, normalizeJunoPreferences, useJunoPreferences } from './junoPreferences';

beforeEach(() => { localStorage.clear(); useJunoPreferences.setState(DEFAULT_JUNO_PREFERENCES); });
describe('device-local Juno preferences', () => {
  it('defaults to Automatic UI/dubbing and two 100% controls', () => {
    expect(normalizeJunoPreferences(undefined)).toEqual({ language: 'auto', dubbingLanguage: 'auto', effectsVolume: 100, musicVolume: 100 });
  });
  it('normalizes unknown data and never hydrates actions or private state', () => {
    expect(normalizeJunoPreferences({ language: 'not-a-language', dubbingLanguage: 'en', effectsVolume: NaN, musicVolume: '50', hand: ['private'], setMusicVolume: 'bad' })).toEqual(DEFAULT_JUNO_PREFERENCES);
    expect(normalizeJunoPreferences({ language: 'de', effectsVolume: -1, musicVolume: 140 })).toEqual({ ...DEFAULT_JUNO_PREFERENCES, language: 'de', effectsVolume: 0, musicVolume: 100 });
  });
  it('does not hydrate an unsupported interface language', () => {
    expect(normalizeJunoPreferences({ language: 'zz', musicVolume: 35 })).toEqual({ ...DEFAULT_JUNO_PREFERENCES, musicVolume: 35 });
  });
  it('persists only its four fields without changing Backspace settings', async () => {
    localStorage.setItem('backspace-language', 'en'); localStorage.setItem('voice-settings', 'unchanged');
    const s = useJunoPreferences.getState(); s.setLanguage('pt'); s.setEffectsVolume(40); s.setMusicVolume(25);
    expect(JSON.parse(localStorage.getItem(JUNO_PREFERENCES_KEY)!)).toEqual({ state: { language: 'pt', dubbingLanguage: 'auto', effectsVolume: 40, musicVolume: 25 }, version: 0 });
    useJunoPreferences.setState(DEFAULT_JUNO_PREFERENCES); localStorage.setItem(JUNO_PREFERENCES_KEY, JSON.stringify({ state: { language: 'de', musicVolume: 65 } }));
    await useJunoPreferences.persist.rehydrate(); expect(useJunoPreferences.getState()).toMatchObject({ language: 'de', musicVolume: 65, effectsVolume: 100 });
    expect(localStorage.getItem('backspace-language')).toBe('en'); expect(localStorage.getItem('voice-settings')).toBe('unchanged');
  });
  it('works in memory when storage is blocked or malformed', async () => {
    localStorage.setItem(JUNO_PREFERENCES_KEY, '{broken'); await useJunoPreferences.persist.rehydrate();
    expect(useJunoPreferences.getState()).toMatchObject(DEFAULT_JUNO_PREFERENCES);
    const get = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    const set = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
    try { await useJunoPreferences.persist.rehydrate(); useJunoPreferences.getState().setMusicVolume(35); expect(useJunoPreferences.getState().musicVolume).toBe(35); }
    finally { get.mockRestore(); set.mockRestore(); }
  });
});
