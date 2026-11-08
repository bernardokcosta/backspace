import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import appI18n from '../../i18n';
import { getLanguageDirection, isSupportedLanguage, type SupportedLanguage } from '../../i18n/languages';
import { useJunoPreferences } from '../../stores/junoPreferences';

/** Share catalogs/loading, never the application's selected language or side effects. */
export function JunoLocale({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation('voice', { i18n: appI18n });
  const preference = useJunoPreferences(s => s.language);
  const language = preference === 'auto' ? i18n.language : preference;
  const scoped = useMemo(() => appI18n.cloneInstance({ lng: appI18n.language }), []);
  const commits = useRef(Promise.resolve());
  useEffect(() => {
    let current = true;
    // Load first so an older, slower selection cannot finish after a newer one.
    void appI18n.loadLanguages(language).catch(() => undefined).then(() => {
      if (!current) return;
      const commit = commits.current.catch(() => undefined).then(async () => {
        if (current) await scoped.changeLanguage(language);
      });
      commits.current = commit;
      return commit;
    }).catch(() => { /* Keep the last loaded locale/fallback on detached scopes. */ });
    return () => { current = false; };
  }, [language, scoped]);
  return <I18nextProvider i18n={scoped}>{children}</I18nextProvider>;
}

/** Game language/dir for real DOM roots. React context crosses the settings portal but DOM inheritance does not, so portalled roots set these explicitly. */
export function useJunoLanguage(): { language: SupportedLanguage; dir: 'ltr' | 'rtl' } {
  const { i18n } = useTranslation('voice', { i18n: appI18n });
  const preference = useJunoPreferences(s => s.language);
  const raw = preference === 'auto' ? i18n.language : preference;
  const language: SupportedLanguage = isSupportedLanguage(raw) ? raw : 'en';
  return { language, dir: getLanguageDirection(language) };
}
