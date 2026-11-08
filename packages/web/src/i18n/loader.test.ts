import { describe, it, expect, vi } from 'vitest';
import { createInstance } from 'i18next';
import { LazyCatalogBackend, listCatalogPaths } from './loader';

describe('LazyCatalogBackend', () => {
  it('loads a namespace for a shipped language from its own catalog file', async () => {
    const backend = new LazyCatalogBackend();
    const catalog = await backend.read('ru', 'common');
    expect(catalog).toBeTypeOf('object');
    expect(Object.keys(catalog).length).toBeGreaterThan(0);
  });

  it('allows an absent target namespace to fall back to bundled English', async () => {
    const backend = new LazyCatalogBackend();
    await expect(backend.read('zz', 'common')).resolves.toEqual({});
  });

  it('treats an English-only future namespace as an empty target bundle', async () => {
    const backend = new LazyCatalogBackend();
    await expect(backend.read('ru', 'nope')).resolves.toEqual({});
  });

  it('identifies itself to i18next as a backend', () => {
    expect(LazyCatalogBackend.type).toBe('backend');
  });

  it('keeps English available after an import failure without an unbounded retry', async () => {
    const read = vi.spyOn(LazyCatalogBackend.prototype, 'read').mockRejectedValue(new Error('HTTP 503'));
    try {
      const scoped = createInstance();
      await scoped.use(LazyCatalogBackend).init({
        lng: 'ar', fallbackLng: 'en', supportedLngs: ['en', 'ar'], load: 'languageOnly',
        ns: ['common'], defaultNS: 'common', partialBundledLanguages: true,
        resources: { en: { common: { probe: 'English fallback' } } },
      });
      expect(scoped.t('probe')).toBe('English fallback');
      await scoped.changeLanguage('ar');
      expect(scoped.t('probe')).toBe('English fallback');
      expect(read).toHaveBeenCalledTimes(1);
    } finally { read.mockRestore(); }
  });
});

describe('listCatalogPaths', () => {
  it('sees every lazily loaded language, and not bundled English', () => {
    const languages = new Set(listCatalogPaths().map((p) => p.language));
    expect([...languages].sort()).toEqual(['ar', 'cs', 'da', 'de', 'es', 'fi', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh']);
  });

  it('sees the same namespaces for every language', () => {
    const byLanguage = new Map<string, string[]>();
    for (const { language, namespace } of listCatalogPaths()) {
      byLanguage.set(language, [...(byLanguage.get(language) ?? []), namespace].sort());
    }
    const [first, ...rest] = [...byLanguage.values()];
    for (const namespaces of rest) expect(namespaces).toEqual(first);
  });
});
