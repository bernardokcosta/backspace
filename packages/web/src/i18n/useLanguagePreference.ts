import { useSyncExternalStore } from 'react';
import { getLanguagePreference, subscribeLanguagePreference, type LanguagePreference } from './index';

/** Preference-only changes matter even when the translated language is unchanged. */
export function useLanguagePreference(): LanguagePreference {
  return useSyncExternalStore(subscribeLanguagePreference, getLanguagePreference, getLanguagePreference);
}
