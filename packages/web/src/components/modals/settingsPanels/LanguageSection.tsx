import { useTranslation } from 'react-i18next';
import { availableLanguages, setLanguagePreference, supportedLanguages } from '../../../i18n';
import { getLanguage } from '../../../i18n';
import { isLanguagePreference } from '../../../i18n/languages';
import { useLanguagePreference } from '../../../i18n/useLanguagePreference';

/**
 * The language picker. Each option is shown in its own language, and the
 * list is deliberately not translated: a user who cannot read the current
 * language still has to be able to find their own.
 */
export function LanguageSection() {
  const { t } = useTranslation(['common']);
  const current = getLanguage();
  const preference = useLanguagePreference();
  // A previewed unreleased language (dev `?lang=`) is shown as the current
  // option so the select does not silently display the wrong value.
  const options = availableLanguages.some((l) => l.code === current)
    ? availableLanguages
    : [...availableLanguages, ...supportedLanguages.filter((l) => l.code === current)];

  return (
    <div>
      <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider mb-1.5">
        {t('common:language.label')}
      </div>
      <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-3.5">
        <label htmlFor="language-select" className="block text-xs text-txt-tertiary mb-2">
          {t('common:language.description')}
        </label>
        <select
          id="language-select"
          value={availableLanguages.some(l => l.code === current) ? preference : current}
          onChange={(e) => { if (isLanguagePreference(e.target.value)) void setLanguagePreference(e.target.value); }}
          className="input-standard w-full appearance-none"
        >
          <option value="auto">{t('common:language.automatic')}</option>
          {options.map((language) => (
            <option key={language.code} value={language.code} lang={language.code}>
              {language.nativeName}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
