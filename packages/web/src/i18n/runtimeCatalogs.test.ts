import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import { supportedLanguages } from './languages';
import { LazyCatalogBackend } from './loader';
import { namespaces, resources } from './resources';

const catalogs = import.meta.glob<Record<string, unknown>>('../locales/*/*.json', { eager: true, import: 'default' });

describe('actual lazy catalogs for shipped languages', () => {
  for (const { code } of supportedLanguages) {
    it(`loads the supplied ${code} bundles without substituting English`, async () => {
      const instance = createInstance();
      await instance.use(LazyCatalogBackend).init({
        lng: code,
        fallbackLng: 'en',
        supportedLngs: supportedLanguages.map(language => language.code),
        load: 'languageOnly',
        ns: namespaces,
        defaultNS: 'common',
        partialBundledLanguages: true,
        resources,
      });
      expect(instance.language).toBe(code);
      for (const namespace of namespaces) {
        const supplied = catalogs[`../locales/${code}/${namespace}.json`];
        // Future English-only namespaces are permitted; completeness belongs to
        // the explicit strict gate, not this provided-bundle integrity check.
        if (!supplied) continue;
        expect(instance.getResourceBundle(code, namespace)).toEqual(supplied);
      }
    });
  }
});
