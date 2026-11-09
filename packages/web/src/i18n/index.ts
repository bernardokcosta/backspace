import { getElectronAPI } from '../platform/platform';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LazyCatalogBackend } from './loader';
import { defaultNS, namespaces, resources } from './resources';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  availableLanguages,
  getLanguageDirection,
  isLanguagePreference,
  isSupportedLanguage,
  pickLanguage,
  readPreviewLanguage,
  supportedLanguageCodes,
  type LanguagePreference,
  type SupportedLanguage,
} from './languages';

export { LANGUAGE_STORAGE_KEY, availableLanguages, supportedLanguages, type SupportedLanguage, type LanguagePreference } from './languages';

const i18n = i18next;
let preference: LanguagePreference = 'auto';
let previewLanguage: SupportedLanguage | null = null;
let generation = 0;
let initialization: Promise<void> | undefined;
let commits = Promise.resolve();
let disposeListeners: (() => void) | undefined;
const preferenceListeners = new Set<() => void>();

function readStoredLanguage(): string | null {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    // Storage can be disabled by browser privacy settings; detection continues without it.
    return null;
  }
}

function writeStoredLanguage(language: LanguagePreference): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // The in-memory selection still applies for this session.
  }
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (navigator.languages && navigator.languages.length > 0) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

function applyDocumentLanguage(language: SupportedLanguage): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.documentElement.dir = getLanguageDirection(language);
  let description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!description) {
    description = document.createElement('meta');
    description.name = 'description';
    document.head.append(description);
  }
  description.content = i18n.t('common:app.description');
  let manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!manifest) {
    manifest = document.createElement('link');
    manifest.rel = 'manifest';
    document.head.append(manifest);
  }
  // Build the URL from the internal catalog value, not the DOM-sourced input
  // even after a membership check. Only shipped manifest filenames can result.
  const manifestLanguage = availableLanguages.find(entry => entry.code === language)?.code ?? DEFAULT_LANGUAGE;
  manifest.setAttribute('href', `${import.meta.env.BASE_URL}manifest-${manifestLanguage}.webmanifest`);
}

function notifyDesktop(language: SupportedLanguage): void {
  if (typeof window === 'undefined') return;
  try {
    const bridge = getElectronAPI();
    bridge?.setLanguage?.(typeof bridge.getSystemLanguages === 'function' ? preference : language);
  } catch {
    // A disconnected legacy bridge cannot prevent a usable renderer language.
  }
}

export function getLanguagePreference(): LanguagePreference {
  return preference;
}

export function subscribeLanguagePreference(listener: () => void): () => void {
  preferenceListeners.add(listener);
  return () => { preferenceListeners.delete(listener); };
}

function applyPreference(next: LanguagePreference): void {
  if (preference === next) return;
  preference = next;
  for (const listener of [...preferenceListeners]) listener();
}

async function preferredSystemLanguages(): Promise<readonly string[]> {
  const bridge = getElectronAPI();
  if (typeof bridge?.getSystemLanguages === 'function') {
    try {
      const value: unknown = await bridge.getSystemLanguages();
      if (Array.isArray(value) && value.length > 0 && value.every((tag): tag is string => typeof tag === 'string')) return value;
    } catch { /* Browser preferences remain usable with older or disconnected shells. */ }
  }
  return browserLanguages();
}

async function ensureInitialized(): Promise<void> {
  if (i18n.isInitialized) return;
  initialization ??= i18n.use(LazyCatalogBackend).use(initReactI18next).init({
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...supportedLanguageCodes],
    load: 'languageOnly',
    defaultNS,
    ns: namespaces,
    resources,
    partialBundledLanguages: true,
    returnNull: false,
    returnEmptyString: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  }).then(() => undefined);
  await initialization;
}

async function resolveAndApply(token: number, browserOverride?: readonly string[], released?: ReadonlySet<string>): Promise<void> {
  const system = preference === 'auto' && !previewLanguage
    ? browserOverride ?? await preferredSystemLanguages()
    : [];
  if (token !== generation) return;
  const language = previewLanguage ?? (preference === 'auto' ? pickLanguage(null, system, released) : preference);
  await ensureInitialized();
  try { await i18n.loadLanguages(language); } catch { /* English stays bundled on a failed target chunk. */ }
  if (token !== generation) return;
  // Serialized commits prevent an older in-flight changeLanguage finishing last.
  const commit = commits.catch(() => undefined).then(async () => {
    if (token !== generation) return;
    await i18n.changeLanguage(language);
    if (token !== generation) return;
    applyDocumentLanguage(language);
    if (!previewLanguage) notifyDesktop(language);
  });
  commits = commit;
  await commit;
}

function installListeners(released?: ReadonlySet<string>): void {
  disposeListeners?.();
  if (typeof window === 'undefined') return;
  const refresh = () => {
    if (preference !== 'auto' || previewLanguage) return;
    void resolveAndApply(++generation, undefined, released);
  };
  const visible = () => { if (document.visibilityState === 'visible') refresh(); };
  const invalidate = () => { generation += 1; };
  window.addEventListener('languagechange', refresh);
  window.addEventListener('focus', refresh);
  window.addEventListener('pagehide', invalidate);
  document.addEventListener('visibilitychange', visible);
  disposeListeners = () => {
    window.removeEventListener('languagechange', refresh);
    window.removeEventListener('focus', refresh);
    window.removeEventListener('pagehide', invalidate);
    document.removeEventListener('visibilitychange', visible);
  };
}

export interface InitI18nOptions {
  /** Overrides `navigator.languages`; used by tests and by the desktop shell. */
  browserLanguages?: readonly string[];
  /** Overrides the set of languages detection may pick; tests use it to reach unreleased ones. */
  releasedLanguages?: ReadonlySet<string>;
  /** A language to show regardless of release state, not persisted; `?lang=` fills it in development. */
  previewLanguage?: SupportedLanguage | null;
}

/**
 * Initialise i18next in the detected language and resolve once that
 * language's catalogs are loaded, so the first render is already
 * translated. Safe to call more than once: later calls only re-run detection.
 */
export async function initI18n(options: InitI18nOptions = {}): Promise<typeof i18n> {
  const token = ++generation;
  previewLanguage = options.previewLanguage !== undefined
    ? options.previewLanguage
    : readPreviewLanguage(typeof window === 'undefined' ? '' : window.location.search, import.meta.env.DEV);
  const stored = readStoredLanguage();
  const released = options.releasedLanguages ?? new Set(availableLanguages.map(language => language.code));
  applyPreference(isSupportedLanguage(stored) && released.has(stored) ? stored : 'auto');
  installListeners(options.releasedLanguages);
  await resolveAndApply(token, options.browserLanguages, options.releasedLanguages);
  return i18n;
}

/** The user picked a language in settings: switch, remember, and tell the desktop shell. */
export async function setLanguage(language: SupportedLanguage): Promise<void> {
  if (isSupportedLanguage(language)) await setLanguagePreference(language);
}

export async function setLanguagePreference(next: LanguagePreference): Promise<void> {
  if (!isLanguagePreference(next)) return;
  const token = ++generation;
  previewLanguage = null;
  applyPreference(next);
  writeStoredLanguage(next);
  await resolveAndApply(token);
}

export function getLanguage(): SupportedLanguage {
  return isSupportedLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
}

export default i18n;
