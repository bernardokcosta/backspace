import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import {
  DESKTOP_CATALOGS,
  resolveDesktopLanguage,
  translateDesktop,
  type DesktopLanguage,
} from './l10n';

// The module reads nothing from Electron at import time on purpose: the
// language is passed in, so the strings are testable in plain Node.

describe('resolveDesktopLanguage', () => {
  it('prefers the language the renderer reported', () => {
    expect(resolveDesktopLanguage('ru', ['de-DE'])).toBe('ru');
  });

  it('falls back to the OS locale mapped to its base language', () => {
    expect(resolveDesktopLanguage(null, ['de-AT'])).toBe('de');
    expect(resolveDesktopLanguage('nonsense', ['ru-RU'])).toBe('ru');
  });

  it('falls back to English when neither is shipped', () => {
    expect(resolveDesktopLanguage(null, ['zz-ZZ'])).toBe('en');
    expect(resolveDesktopLanguage(null, [])).toBe('en');
  });

  it('follows preferred UI-language order, aliases and release eligibility', () => {
    expect(resolveDesktopLanguage('auto', ['fr-CA', 'de'])).toBe('fr');
    expect(resolveDesktopLanguage('auto', ['fr-CA', 'de'], new Set(['en', 'fr', 'de']))).toBe('fr');
    expect(resolveDesktopLanguage(null, ['no-NO'], new Set(['en', 'nb']))).toBe('nb');
    expect(resolveDesktopLanguage('pt', ['zh-TW'])).toBe('pt');
  });
});

vi.mock('electron', () => ({ app: { getPath: () => '/isolated-i18n-test', getPreferredSystemLanguages: () => systemLanguages } }));
let systemLanguages: string[] = ['de-DE'];

describe('native preference lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    systemLanguages = ['de-DE'];
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => '{"language":"auto"}');
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
  });

  it('keeps Automatic live even when persisting a mode change fails', async () => {
    const native = await import('./l10n');
    expect(native.getDesktopLanguage()).toBe('de');
    native.saveStoredLanguage('pt');
    expect(native.getDesktopLanguage()).toBe('pt');
    vi.mocked(fs.writeFileSync).mockImplementation(() => { throw Error('denied'); });
    expect(() => native.saveStoredLanguage('auto')).toThrow('denied');
    systemLanguages = ['ru-RU'];
    expect(native.getDesktopLanguagePreference()).toBe('auto');
    expect(native.getDesktopLanguage()).toBe('ru');
    expect(native.getDesktopLanguageQuery()).toEqual({ lang: 'ru', preference: 'auto', released: 'en,pt,es,fr,de,it,ru,uk,pl,nl,sv,da,nb,fi,cs,ro,tr,ar,hi,id,vi,th,ja,ko,zh' });
  });

  it('preserves old explicit JSON and does not reread disk on focus', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('{"language":"pt"}');
    const native = await import('./l10n');
    expect(native.getDesktopLanguagePreference()).toBe('pt');
    systemLanguages = ['ru'];
    expect(native.getDesktopLanguage()).toBe('pt');
    expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('defaults invalid persistence to Automatic without a startup write', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('broken-json');
    const native = await import('./l10n');
    expect(native.getDesktopLanguagePreference()).toBe('auto');
    expect(native.getDesktopLanguage()).toBe('de');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe('translateDesktop', () => {
  it('translates native update notification text with the real version', () => {
    expect(translateDesktop('pt', 'update.notificationReady')).toBe('Atualização do Backspace Fork pronta');
    expect(translateDesktop('pt', 'update.notificationRestart', { version: '9.9.9' })).toBe('Clique para reiniciar e instalar a versão 9.9.9.');
  });
  it('describes a failed restart directly, without a recursive startup phrase', () => {
    expect(translateDesktop('en', 'update.restartFailed')).toBe('The app could not restart to install the update.');
    expect(translateDesktop('zh', 'update.restartFailed')).toBe('无法重新启动以安装更新。');
  });
  it('returns the string for the language', () => {
    expect(translateDesktop('en', 'tray.show')).toBe('Show Backspace');
    expect(translateDesktop('ru', 'tray.show')).toBe('Показать Backspace');
    expect(translateDesktop('de', 'tray.show')).toBe('Backspace anzeigen');
  });

  it('interpolates a version into the download item', () => {
    expect(translateDesktop('en', 'update.downloadVersion', { version: '1.2.3' })).toBe('Download Backspace 1.2.3…');
    expect(translateDesktop('de', 'update.downloadVersion', { version: '1.2.3' })).toBe('Backspace 1.2.3 herunterladen…');
  });

  it('uses bundled English for an untranslated native key', () => {
    const translated = DESKTOP_CATALOGS.fr['tray.show'];
    try {
      delete DESKTOP_CATALOGS.fr['tray.show'];
      expect(translateDesktop('fr', 'tray.show')).toBe('Show Backspace');
    } finally {
      if (translated !== undefined) DESKTOP_CATALOGS.fr['tray.show'] = translated;
    }
  });
});

describe('DESKTOP_CATALOGS', () => {
  it('never supplies a key absent from mandatory English', () => {
    const english = Object.keys(DESKTOP_CATALOGS.en).sort();
    for (const language of Object.keys(DESKTOP_CATALOGS) as DesktopLanguage[]) {
      for (const key of Object.keys(DESKTOP_CATALOGS[language])) expect(english, language).toContain(key);
    }
  });

  it('uses the same placeholders in every language', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(DESKTOP_CATALOGS.en) as (keyof typeof DESKTOP_CATALOGS.en)[]) {
      const expected = placeholders(DESKTOP_CATALOGS.en[key]!);
      for (const language of Object.keys(DESKTOP_CATALOGS) as DesktopLanguage[]) {
        const value = DESKTOP_CATALOGS[language][key];
        if (value !== undefined) expect(placeholders(value), `${language}:${key}`).toEqual(expected);
      }
    }
  });
});
