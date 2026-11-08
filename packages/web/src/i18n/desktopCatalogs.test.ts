import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readDesktopCatalogs } from '../../../../scripts/i18n/desktop.mjs';
import { runAllChecks } from '../../../../scripts/i18n/check.mjs';
import { main, parseCheckArguments } from '../../../../scripts/check-i18n.mjs';

function rootWith(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), 'i18n-native-check-'));
  for (const [file, value] of Object.entries(files)) { const absolute = path.join(root, file); mkdirSync(path.dirname(absolute), { recursive: true }); writeFileSync(absolute, value); }
  return root;
}

describe('static native catalog reader', () => {
  it('reads literal tables and typed references without executing native or HTML code', () => {
    const root = rootWith({
      'packages/desktop/src/l10n.ts': "throw Error('never execute'); const en={label:'Show'} as const; const de: Catalog={label:'Anzeigen'}; export const DESKTOP_CATALOGS={en,de};",
      'packages/desktop/resources/recovery.html': "<script>throw Error('never execute'); const STRINGS={en:{title:'Recovery'},de:{title:'Wiederherstellung'}};</script>",
      'packages/desktop/resources/instance-picker.html': "<script>const STRINGS={en:{title:'Connect'},de:{title:'Verbinden'}};</script>",
    });
    const result = readDesktopCatalogs(root);
    expect(result.findings).toEqual([]);
    expect(result.catalogs).toHaveLength(6);
    expect(result.catalogs.find((c: { surface: string; language: string }) => c.surface === 'main' && c.language === 'de')?.values).toEqual({ label: 'Anzeigen' });
  });

  it('rejects dynamic expressions, malformed code and absent sources as findings', () => {
    const root = rootWith({ 'packages/desktop/src/l10n.ts': "const en={label: fetch('https://must-not-run.test')}; const DESKTOP_CATALOGS={en};" });
    const result = readDesktopCatalogs(root);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.catalogs).toEqual([]);
  });
  it('requires English for literal native HTML call sites and data-i18n attributes', () => {
    const root = rootWith({
      'packages/desktop/src/l10n.ts': "const DESKTOP_CATALOGS={en:{label:'Show'}};",
      'packages/desktop/resources/recovery.html': '<p data-i18n="missingAttribute"></p><script>const STRINGS={en:{title:"Recovery"}}; t("missingCall");</script>',
      'packages/desktop/resources/instance-picker.html': '<script>const STRINGS={en:{title:"Connect"}};</script>',
    });
    const result = readDesktopCatalogs(root);
    expect(result.findings.map((f: { message: string }) => f.message).join(' ')).toContain('missingAttribute');
    expect(result.findings.map((f: { message: string }) => f.message).join(' ')).toContain('missingCall');
  });

  it('keeps normal web-only validation independent from absent native inputs', () => {
    const root = rootWith({ 'packages/web/src/locales/en/common.json': '{"hello":"Hello"}', 'packages/web/src/locales/en/errors.json': '{"generic":"Error"}' });
    expect(runAllChecks(root)).toEqual([]);
    expect(runAllChecks(root, { includeDesktop: true }).length).toBeGreaterThan(0);
  });
  it('detects hardcoded app-owned native notification copy', () => {
    const root = rootWith({ 'packages/desktop/src/main.ts': 'showNotification("Update ready", `Click to install version ${version}`);' });
    expect(runAllChecks(root, { includeDesktop: true })).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'literal-string', file: 'packages/desktop/src/main.ts' }),
    ]));
  });
});

describe('i18n CLI flags', () => {
  it('parses strict coverage, locale selection and opt-in native checks', () => {
    expect(parseCheckArguments(['--strict', '--locales=en,pt', '--include-desktop'])).toEqual({ strict: true, locales: ['en', 'pt'], includeDesktop: true, writePending: false });
    expect(parseCheckArguments([])).toEqual({ strict: false, includeDesktop: false, writePending: false });
  });
  it('rejects unknown flags and empty locale lists', () => {
    expect(() => parseCheckArguments(['--skip-everything'])).toThrow();
    expect(() => parseCheckArguments(['--locales='])).toThrow();
  });
  it('returns real success/failure exit codes for valid, unknown and incomplete locales', () => {
    const root = rootWith({
      'packages/web/src/locales/en/common.json': '{"new":"English feature"}',
      'packages/web/src/locales/en/errors.json': '{"generic":"Error"}',
      'packages/web/src/locales/de/common.json': '{}',
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(main([], root)).toBe(0);
      expect(main(['--strict'], root)).toBe(1);
      expect(main(['--locales=xx'], root)).toBe(1);
      expect(main(['--include-desktop'], root)).toBe(1);
    } finally { log.mockRestore(); error.mockRestore(); }
  });
});
