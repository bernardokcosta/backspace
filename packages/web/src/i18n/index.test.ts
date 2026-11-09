import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import i18n, { initI18n, setLanguage, setLanguagePreference, getLanguagePreference, subscribeLanguagePreference, getLanguage, LANGUAGE_STORAGE_KEY } from './index';
import { availableLanguages, type LanguagePreference } from './languages';

const allReleased = new Set(['en', 'ru', 'de']);

beforeEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, 'backspace', { configurable: true, value: undefined });
  localStorage.clear();
  document.documentElement.lang = '';
  document.documentElement.dir = '';
});

afterEach(() => { vi.restoreAllMocks(); });

function bridge(getSystemLanguages: () => Promise<readonly string[]>) {
  const setLanguage = vi.fn();
  Object.defineProperty(window, 'backspace', { configurable: true, value: { getSystemLanguages, setLanguage } });
  return setLanguage;
}

describe('Automatic preference lifecycle', () => {
  it('auto mode changes notify when locale is unchanged', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
    await initI18n();
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
    const listener = vi.fn();
    const dispose = subscribeLanguagePreference(listener);
    await setLanguagePreference('en');
    await setLanguagePreference('auto');
    expect(getLanguage()).toBe('en');
    expect(getLanguagePreference()).toBe('auto');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('auto');
    expect(listener).toHaveBeenCalledTimes(2);
    dispose();
    await setLanguagePreference('pt');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('explicit survives languagechange while Automatic follows it', async () => {
    const langs = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en']);
    await initI18n();
    await setLanguagePreference('pt');
    langs.mockReturnValue(['de']);
    window.dispatchEvent(new Event('languagechange'));
    await vi.waitFor(() => expect(getLanguage()).toBe('pt'));
    await setLanguagePreference('auto');
    expect(getLanguage()).toBe('de');
    langs.mockReturnValue(['ru']);
    window.dispatchEvent(new Event('languagechange'));
    await vi.waitFor(() => expect(getLanguage()).toBe('ru'));
  });

  it('late native response loses to explicit', async () => {
    let resolve!: (value: readonly string[]) => void;
    const reply = new Promise<readonly string[]>(r => { resolve = r; });
    const sent = bridge(() => reply);
    const starting = initI18n();
    await setLanguagePreference('pt');
    resolve(['ru']);
    await starting;
    expect(getLanguagePreference()).toBe('pt');
    expect(getLanguage()).toBe('pt');
    expect(sent).toHaveBeenLastCalledWith('pt');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('pt');
  });

  it('reinitialization owns one listener set and native mode follows focus', async () => {
    const get = vi.fn(async () => ['en']);
    const sent = bridge(get);
    await initI18n();
    await initI18n();
    get.mockResolvedValue(['de']);
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(getLanguage()).toBe('de'));
    expect(get).toHaveBeenCalledTimes(3);
    expect(sent).toHaveBeenLastCalledWith('auto');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
  });

  it('preview never persists or notifies native and ignores system refreshes', async () => {
    const sent = bridge(async () => ['ru']);
    await initI18n({ previewLanguage: 'de' });
    window.dispatchEvent(new Event('languagechange'));
    expect(getLanguage()).toBe('de');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
    expect(sent).not.toHaveBeenCalled();
    await setLanguagePreference('auto');
    expect(getLanguage()).toBe('ru');
  });

  it('uses navigator for old, rejected or malformed bridges and keeps live mode on storage denial', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de']);
    bridge(async () => { throw Error('unavailable'); });
    await initI18n();
    expect(getLanguage()).toBe('de');
    bridge(async () => 'bad' as unknown as readonly string[]);
    await initI18n();
    expect(getLanguage()).toBe('de');
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw Error('disabled'); });
    await setLanguagePreference('pt');
    expect(getLanguage()).toBe('pt');
    expect(getLanguagePreference()).toBe('pt');
    const legacy = vi.fn();
    Object.defineProperty(window, 'backspace', { configurable: true, value: { setLanguage: legacy } });
    await setLanguagePreference('auto');
    expect(legacy).toHaveBeenLastCalledWith('de');
  });
});

describe('initI18n', () => {
  it('starts in the stored language and reflects it on the document', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ru');
    await initI18n({ browserLanguages: ['en-US'], releasedLanguages: allReleased });
    expect(i18n.resolvedLanguage).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('falls back to the browser language when nothing is stored', async () => {
    await initI18n({ browserLanguages: ['de-DE', 'en'], releasedLanguages: allReleased });
    expect(i18n.resolvedLanguage).toBe('de');
  });

  it('has the selected language loaded before it resolves', async () => {
    await initI18n({ browserLanguages: ['de'], releasedLanguages: allReleased });
    expect(i18n.hasResourceBundle('de', 'common')).toBe(true);
    expect(i18n.t('common:actions.cancel')).toBe('Abbrechen');
  });
});

describe('initI18n release gate', () => {
  it('ignores a stored unreleased language and starts in English', async () => {
    // Every shipped language is released now; keep the gate covered with an
    // explicit released set so the next language can rely on it.
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ru');
    await initI18n({ browserLanguages: ['ru-RU'], releasedLanguages: new Set(['en']) });
    expect(i18n.resolvedLanguage).toBe('en');
  });
});

describe('initI18n preview', () => {
  it('shows an explicitly previewed language without persisting it', async () => {
    await initI18n({ browserLanguages: ['en'], previewLanguage: 'de' });
    expect(i18n.resolvedLanguage).toBe('de');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
  });
});

describe('setLanguage', () => {
  it.each(availableLanguages.map(entry => entry.code))('selects only the internal manifest filename for %s', async language => {
    await setLanguage(language);
    expect(document.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe(`/manifest-${language}.webmanifest`);
  });
  it.each(['javascript:alert(1)', '//foreign.example/manifest', '../other', 'pt\" onload=\"alert(1)'])('does not put an unexpected preference into a URL: %s', async value => {
    await setLanguage('pt');
    await setLanguagePreference(value as LanguagePreference);
    expect(document.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe('/manifest-pt.webmanifest');
    expect(getLanguagePreference()).toBe('pt');
  });
  it('translates app metadata and selects a localized manifest without changing install identity', async () => {
    document.querySelector('meta[name="description"]')?.remove();
    document.querySelector('link[rel="manifest"]')?.remove();
    await setLanguage('pt');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toContain('hospedada por você');
    expect(document.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe('/manifest-pt.webmanifest');
    await setLanguage('en');
    expect(document.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe('/manifest-en.webmanifest');
  });
  it('switches, persists, and updates the document', async () => {
    await initI18n({ browserLanguages: ['en'] });
    await setLanguage('ru');
    expect(i18n.resolvedLanguage).toBe('ru');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
    expect(i18n.t('common:actions.cancel')).toBe('Отмена');
  });

  it('falls back to English for a key the language has not translated', async () => {
    await initI18n({ browserLanguages: ['en'] });
    await setLanguage('de');
    i18n.addResource('en', 'common', 'test.onlyEnglish', 'English only');
    expect(i18n.t('common:test.onlyEnglish')).toBe('English only');
  });

  it('does not allow an older lazy load to overwrite the newest choice', async () => {
    await initI18n({ browserLanguages: ['en'] });
    const load = i18n.loadLanguages.bind(i18n);
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(i18n, 'loadLanguages').mockImplementation(language => language === 'ru' ? wait.then(() => load(language)) : load(language));
    const older = setLanguage('ru');
    await setLanguage('pt');
    release();
    await older;
    expect(getLanguage()).toBe('pt');
    expect(i18n.language).toBe('pt');
    expect(document.documentElement.lang).toBe('pt');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('pt');
  });

  it.each(['ar', 'ru', 'ja'] as const)('uses the English namespace and whole plural family without losing selected %s', async language => {
    await initI18n({ browserLanguages: ['en'] });
    i18n.addResourceBundle('en', 'newFeature', { label: 'English feature', items_one: '{{count}} item', items_other: '{{count}} items' });
    await setLanguage(language);
    expect(getLanguage()).toBe(language);
    expect(document.documentElement.lang).toBe(language);
    expect(i18n.t('newFeature:label')).toBe('English feature');
    for (const count of [0, 1, 2, 3, 11, 100, 1000000]) expect(i18n.t('newFeature:items', { count })).toBe(`${count} ${count === 1 ? 'item' : 'items'}`);
  });
});
