import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { availableLanguages, isSupportedLanguage, type SupportedLanguage } from '../i18n/languages';
import { JUNO_DUBBINGS, type JunoDubbingLanguage } from '../components/games/junoAssets';

export interface JunoPreferences {
  language: 'auto' | SupportedLanguage;
  dubbingLanguage: 'auto' | JunoDubbingLanguage;
  effectsVolume: number;
  musicVolume: number;
}
export const JUNO_PREFERENCES_KEY = 'backspace-juno-preferences';
export const DEFAULT_JUNO_PREFERENCES: JunoPreferences = { language: 'auto', dubbingLanguage: 'auto', effectsVolume: 100, musicVolume: 100 };
const volume = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(0, Math.min(100, value))) : 100;
export function normalizeJunoPreferences(value: unknown): JunoPreferences {
  const p = value && typeof value === 'object' ? value as Partial<Record<keyof JunoPreferences, unknown>> : {};
  return { language: isSupportedLanguage(p.language) && availableLanguages.some(language => language.code === p.language) ? p.language : 'auto',
    dubbingLanguage: typeof p.dubbingLanguage === 'string' && Object.hasOwn(JUNO_DUBBINGS, p.dubbingLanguage) ? p.dubbingLanguage as JunoDubbingLanguage : 'auto',
    effectsVolume: volume(p.effectsVolume), musicVolume: volume(p.musicVolume) };
}
// Browser privacy settings must not turn a harmless personal control into an error.
const storage: StateStorage = {
  getItem: key => { try { const raw = localStorage.getItem(key); if (raw) JSON.parse(raw); return raw; } catch { return null; } },
  setItem: (key, value) => { try { localStorage.setItem(key, value); } catch { /* In-memory preferences remain usable. */ } },
  removeItem: key => { try { localStorage.removeItem(key); } catch { /* Storage may be unavailable. */ } },
};
interface State extends JunoPreferences {
  setLanguage: (language: JunoPreferences['language']) => void;
  setDubbingLanguage: (language: JunoPreferences['dubbingLanguage']) => void;
  setEffectsVolume: (value: number) => void;
  setMusicVolume: (value: number) => void;
}
export const useJunoPreferences = create<State>()(persist(set => ({
  ...DEFAULT_JUNO_PREFERENCES,
  setLanguage: language => set({ language: isSupportedLanguage(language) ? language : 'auto' }),
  setDubbingLanguage: dubbingLanguage => set({ dubbingLanguage: normalizeJunoPreferences({ dubbingLanguage }).dubbingLanguage }),
  setEffectsVolume: value => set({ effectsVolume: volume(value) }),
  setMusicVolume: value => set({ musicVolume: volume(value) }),
}), { name: JUNO_PREFERENCES_KEY, storage: createJSONStorage(() => storage),
  partialize: ({ language, dubbingLanguage, effectsVolume, musicVolume }) => ({ language, dubbingLanguage, effectsVolume, musicVolume }),
  merge: (stored, current) => ({ ...current, ...normalizeJunoPreferences(stored) }),
}));
