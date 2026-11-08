/**
 * The localization consistency check. Rules and rationale live in
 * docs/systems/localization.md ("Consistency check"). This module is pure:
 * every check takes a repository root and returns findings; the CLI in
 * scripts/check-i18n.mjs owns printing and the exit code.
 *
 * A finding is `{ rule, file, line?, message }` with `file` relative to the
 * root, using forward slashes.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { getTypeScript as ts, readLiteralBinding, readDesktopCatalogs } from './desktop.mjs';

export const SOURCE_LANGUAGE = 'en';
export const LOCALES_DIR = 'packages/web/src/locales';
export const WEB_SRC_DIR = 'packages/web/src';
export const FORMATTERS_FILE = 'packages/web/src/i18n/formatters.ts';
export const ERRORS_TS = 'packages/shared/src/errors.ts';
export const ALLOWLIST_FILE = 'scripts/i18n-allowlist.json';
export const PENDING_FILE = 'scripts/i18n-pending.txt';

const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const PLURAL_SUFFIX_RE = /_(zero|one|two|few|many|other)$/;

/**
 * CLDR categories a language must supply for a plural family, from the same
 * `Intl.PluralRules` data i18next selects forms with at runtime. Derived, not
 * listed, so adding a language never touches this file. Returns null for a
 * code Intl does not know: it would silently resolve to the host locale, and
 * a catalog directory the runtime cannot pluralize is a finding, not a guess.
 */
const pluralFormsCache = new Map();
export function requiredPluralForms(lng) {
  if (pluralFormsCache.has(lng)) return pluralFormsCache.get(lng);
  let forms = null;
  try {
    const resolved = new Intl.PluralRules(lng).resolvedOptions();
    const requestedBase = lng.toLowerCase().split('-')[0];
    const resolvedBase = resolved.locale.toLowerCase().split('-')[0];
    // Sorted: ICU versions differ on the order, and callers only need the set.
    if (requestedBase === resolvedBase) forms = [...resolved.pluralCategories].sort();
  } catch {
    forms = null;
  }
  pluralFormsCache.set(lng, forms);
  return forms;
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function readJson(abs) {
  return JSON.parse(readFileSync(abs, 'utf8'));
}

/** Recursively list files under `dir` (absolute), returning root-relative posix paths. */
function walk(root, dir, predicate, out = []) {
  const abs = path.join(root, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const rel = toPosix(path.join(dir, entry.name));
    if (entry.isDirectory()) walk(root, rel, predicate, out);
    else if (predicate(rel)) out.push(rel);
  }
  return out.sort();
}

function isTestFile(rel) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || rel.includes('/test/') || rel.includes('/__tests__/');
}

function isSourceFile(rel) {
  return /\.[cm]?[jt]sx?$/.test(rel) && !rel.endsWith('.d.ts') && !isTestFile(rel);
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

/** Flatten a nested catalog object into `{ 'a.b.c': 'value' }`. */
export function flattenCatalog(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flattenCatalog(value, full, out);
    else out[full] = value;
  }
  return out;
}

/** Retain object paths so flattening cannot hide an invalid string-leaf shape. */
function catalogObjectPaths(obj, prefix = '', out = []) {
  for (const [key, value] of Object.entries(obj)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const full = prefix ? `${prefix}.${key}` : key;
    const empty = Object.keys(value).length === 0;
    out.push({ key: full, empty });
    if (!empty) catalogObjectPaths(value, full, out);
  }
  return out;
}

/** `storage.deleted_few` -> `{ base: 'storage.deleted', form: 'few' }`; a plain key has form null. */
export function splitPlural(key) {
  const match = PLURAL_SUFFIX_RE.exec(key);
  if (!match) return { base: key, form: null };
  return { base: key.slice(0, -match[0].length), form: match[1] };
}

/**
 * Load every `<lng>/<ns>.json` under the locales directory.
 *
 * Returns `{ languages, namespaces, catalogs }` where `catalogs[lng][ns]` is
 * the flattened catalog and `files[lng][ns]` its root-relative path.
 * `namespaces` is the set seen in the source language; other languages may
 * carry extra files, which the parity rule reports.
 */
export function loadCatalogs(root) {
  const localesAbs = path.join(root, LOCALES_DIR);
  const result = { languages: [], namespaces: [], catalogs: {}, files: {}, findings: [] };
  const objects = [];
  if (!existsSync(localesAbs)) return result;

  for (const entry of readdirSync(localesAbs, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const lng = entry.name;
    result.languages.push(lng);
    result.catalogs[lng] = {};
    result.files[lng] = {};
    for (const file of readdirSync(path.join(localesAbs, lng))) {
      if (!file.endsWith('.json')) continue;
      const ns = file.slice(0, -'.json'.length);
      const rel = `${LOCALES_DIR}/${lng}/${file}`;
      try {
        const data = readJson(path.join(root, rel));
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected a namespace object');
        for (const entry of catalogObjectPaths(data)) objects.push({ lng, ns, file: rel, ...entry });
        result.catalogs[lng][ns] = flattenCatalog(data);
        for (const [key, value] of Object.entries(result.catalogs[lng][ns])) {
          if (typeof value !== 'string' || !value.trim()) result.findings.push({ rule: 'catalog-value', file: rel, message: `key "${key}" must contain nonempty string copy` });
        }
      } catch (error) {
        result.catalogs[lng][ns] = {};
        result.findings.push({ rule: 'catalog-value', file: rel, message: `Invalid catalog: ${error.message}` });
      }
      result.files[lng][ns] = rel;
    }
  }
  const sourceLeaves = new Map(Object.entries(result.catalogs[SOURCE_LANGUAGE] ?? {}).map(([ns, flat]) => [
    ns, new Set(Object.keys(flat).map(key => splitPlural(key).base)),
  ]));
  for (const { lng, ns, file, key, empty } of objects) {
    const base = splitPlural(key).base;
    // Empty target branches can omit copy, but an object at a string/plural
    // leaf blocks i18next's fallback instead of behaving like an absent key.
    if ((lng === SOURCE_LANGUAGE && empty) || sourceLeaves.get(ns)?.has(base)) {
      result.findings.push({ rule: 'catalog-value', file, message: `key "${key}" must contain nonempty string copy, not an object` });
    }
  }
  result.languages.sort();
  result.namespaces = Object.keys(result.catalogs[SOURCE_LANGUAGE] ?? {}).sort();
  return result;
}

/** Group flattened keys into plural families: base -> { form|'' : value }. */
function families(flat) {
  const out = new Map();
  for (const [key, value] of Object.entries(flat)) {
    const { base, form } = splitPlural(key);
    if (!out.has(base)) out.set(base, new Map());
    out.get(base).set(form ?? '', value);
  }
  return out;
}

function isPluralFamily(family) {
  for (const form of family.keys()) if (form !== '') return true;
  return false;
}

function placeholdersOf(text) {
  const names = new Set();
  for (const match of String(text).matchAll(/\{\{\s*([^{}\s,]+)/g)) names.add(match[1]);
  return names;
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function fileFor(loaded, lng, ns) {
  return loaded.files[lng]?.[ns] ?? `${LOCALES_DIR}/${lng}/${ns}.json`;
}

// ---------------------------------------------------------------------------
// Rule 1: parity
// ---------------------------------------------------------------------------

export function checkParity(root, options = {}) {
  const loaded = loadCatalogs(root);
  const findings = [];
  const source = loaded.catalogs[SOURCE_LANGUAGE] ?? {};

  const declared = readLanguageRegistry(root).entries.map(entry => entry.code);
  const coverage = options.locales ?? (declared.length ? declared : loaded.languages);
  const languages = new Set([...loaded.languages, ...(options.strict ? coverage : [])]);
  for (const lng of languages) {
    if (lng === SOURCE_LANGUAGE) continue;
    const target = loaded.catalogs[lng] ?? {};

    for (const ns of loaded.namespaces) {
      if (!target[ns]) {
        if (options.strict && coverage.includes(lng)) findings.push({ rule: 'parity', file: fileFor(loaded, lng, ns), message: `namespace "${ns}" is missing for ${lng}` });
        continue;
      }
      const sourceFamilies = families(source[ns]);
      const targetFamilies = families(target[ns]);
      for (const base of sourceFamilies.keys()) {
        if (options.strict && coverage.includes(lng) && !targetFamilies.has(base)) {
          findings.push({ rule: 'parity', file: fileFor(loaded, lng, ns), message: `key "${base}" exists in ${SOURCE_LANGUAGE} but not in ${lng}` });
        }
      }
      for (const base of targetFamilies.keys()) {
        if (!sourceFamilies.has(base)) {
          findings.push({ rule: 'parity', file: fileFor(loaded, lng, ns), message: `key "${base}" exists in ${lng} but not in ${SOURCE_LANGUAGE}` });
        }
      }
    }

    for (const ns of Object.keys(target)) {
      if (!source[ns]) {
        findings.push({ rule: 'parity', file: fileFor(loaded, lng, ns), message: `namespace "${ns}" exists for ${lng} but not for ${SOURCE_LANGUAGE}` });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 2: placeholders
// ---------------------------------------------------------------------------

export function checkPlaceholders(root) {
  const loaded = loadCatalogs(root);
  const findings = [];
  const source = loaded.catalogs[SOURCE_LANGUAGE] ?? {};

  for (const lng of loaded.languages) {
    if (lng === SOURCE_LANGUAGE) continue;
    for (const ns of loaded.namespaces) {
      const target = loaded.catalogs[lng]?.[ns];
      if (!target) continue;
      const sourceFamilies = families(source[ns]);
      const targetFamilies = families(target);
      for (const [base, sourceForms] of sourceFamilies) {
        const targetForms = targetFamilies.get(base);
        if (!targetForms) continue;
        const expected = new Set();
        for (const value of sourceForms.values()) for (const name of placeholdersOf(value)) expected.add(name);
        for (const [form, value] of targetForms) {
          const required = new Set(expected);
          // Singular source phrases may state the number implicitly; Arabic
          // one/two likewise have explicit lexical singular/dual forms.
          if ((form === 'one' && sourceForms.has('one') && !placeholdersOf(sourceForms.get('one')).has('count'))
            || (lng === 'ar' && (form === 'one' || form === 'two'))) required.delete('count');
          const actual = placeholdersOf(value);
          const absent = [...required].filter(name => !actual.has(name));
          const extra = [...actual].filter(name => !expected.has(name));
          if (absent.length || extra.length) findings.push({
            rule: 'placeholders', file: fileFor(loaded, lng, ns),
            message: `key "${base}${form ? `_${form}` : ''}" has invalid placeholders (missing: ${absent.join(', ')}; extra: ${extra.join(', ')})`,
          });
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 3: plural-forms
// ---------------------------------------------------------------------------

export function checkPluralForms(root) {
  const loaded = loadCatalogs(root);
  const findings = [];

  // One finding per language the runtime cannot pluralize, not one per key.
  const unknownLanguages = new Set();

  for (const ns of loaded.namespaces) {
    // A family is plural if any language gives it a suffix.
    const pluralBases = new Set();
    const perLanguage = new Map();
    for (const lng of loaded.languages) {
      const flat = loaded.catalogs[lng]?.[ns];
      if (!flat) continue;
      const fam = families(flat);
      perLanguage.set(lng, fam);
      for (const [base, forms] of fam) if (isPluralFamily(forms)) pluralBases.add(base);
    }

    for (const base of pluralBases) {
      for (const [lng, fam] of perLanguage) {
        const forms = fam.get(base);
        if (!forms) continue; // parity reports the missing family
        const required = requiredPluralForms(lng);
        if (!required) {
          unknownLanguages.add(lng);
          continue;
        }
        const missing = required.filter((form) => !forms.has(form));
        const unexpected = [...forms.keys()].filter((form) => form !== '' && !PLURAL_SUFFIXES.includes(form));
        if (forms.has('')) {
          findings.push({ rule: 'plural-forms', file: fileFor(loaded, lng, ns), message: `key "${base}" mixes a plain value with plural forms in ${lng}` });
        }
        if (missing.length > 0) {
          findings.push({ rule: 'plural-forms', file: fileFor(loaded, lng, ns), message: `plural key "${base}" is missing _${missing.join(', _')} for ${lng}` });
        }
        if (unexpected.length > 0) {
          findings.push({ rule: 'plural-forms', file: fileFor(loaded, lng, ns), message: `plural key "${base}" has unknown form _${unexpected.join(', _')} in ${lng}` });
        }
      }
    }
  }
  for (const lng of unknownLanguages) {
    findings.push({ rule: 'plural-forms', file: `${LOCALES_DIR}/${lng}`, message: `language "${lng}" is not known to Intl.PluralRules, so its plural forms cannot be checked` });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 4: count-without-plural
// ---------------------------------------------------------------------------

const USE_TRANSLATION_RE = /useTranslation\(\s*(?:\[\s*)?['"]([\w-]+)['"]/;
const T_CALL_RE = /\b(?:i18n\.)?t\(\s*(['"])([^'"\n]+)\1\s*,\s*\{([^}]*)\}/g;

function resolveKey(rawKey, defaultNs) {
  const colon = rawKey.indexOf(':');
  if (colon > 0) return { ns: rawKey.slice(0, colon), key: rawKey.slice(colon + 1) };
  return { ns: defaultNs, key: rawKey };
}

export function checkCountWithoutPlural(root) {
  const loaded = loadCatalogs(root);
  const source = loaded.catalogs[SOURCE_LANGUAGE] ?? {};
  const familiesByNs = new Map(Object.entries(source).map(([ns, flat]) => [ns, families(flat)]));
  const findings = [];

  for (const rel of walk(root, WEB_SRC_DIR, isSourceFile)) {
    const text = readFileSync(path.join(root, rel), 'utf8');
    if (!text.includes('count')) continue;
    const defaultNs = USE_TRANSLATION_RE.exec(text)?.[1] ?? 'common';
    for (const match of text.matchAll(T_CALL_RE)) {
      if (!/\bcount\s*[:,}]/.test(match[3]) && !/\bcount\b\s*$/.test(match[3].trim())) continue;
      const { ns, key } = resolveKey(match[2], defaultNs);
      const fam = familiesByNs.get(ns)?.get(key);
      if (fam && isPluralFamily(fam)) continue;
      findings.push({
        rule: 'count-without-plural',
        file: rel,
        line: lineOf(text, match.index),
        message: `count passed to "${ns}:${key}", which has no plural forms in ${SOURCE_LANGUAGE}`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 5: untranslated
// ---------------------------------------------------------------------------

function loadAllowlist(root) {
  const abs = path.join(root, ALLOWLIST_FILE);
  if (!existsSync(abs)) return [];
  const data = readJson(abs);
  return Array.isArray(data) ? data : [];
}

/** True when the value has no letters once placeholders are removed. */
export function isPlaceholderOnly(value) {
  return !/\p{L}/u.test(String(value).replace(/\{\{[^{}]*\}\}/g, ''));
}

export function checkUntranslated(root, options = {}) {
  const loaded = loadCatalogs(root);
  const allow = options.allowlist ?? loadAllowlist(root);
  const findings = [];
  const source = loaded.catalogs[SOURCE_LANGUAGE] ?? {};

  for (const lng of loaded.languages) {
    if (lng === SOURCE_LANGUAGE) continue;
    for (const ns of loaded.namespaces) {
      const target = loaded.catalogs[lng]?.[ns];
      if (!target) continue;
      for (const [key, value] of Object.entries(target)) {
        const sourceValue = source[ns]?.[key];
        if (sourceValue === undefined || value !== sourceValue) continue;
        if (isPlaceholderOnly(value) || isAllowedTranslation(allow, lng, ns, key, value)) continue;
        findings.push({ rule: 'untranslated', file: fileFor(loaded, lng, ns), message: `key "${key}" is identical to ${SOURCE_LANGUAGE}: "${value}"` });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 6: direct-intl
// ---------------------------------------------------------------------------

const DIRECT_INTL_RE = /toLocaleDateString|toLocaleTimeString|toLocaleString|\bIntl\./g;

export function checkDirectIntl(root) {
  const findings = [];
  for (const rel of walk(root, WEB_SRC_DIR, isSourceFile)) {
    if (rel === FORMATTERS_FILE) continue;
    const text = readFileSync(path.join(root, rel), 'utf8');
    for (const match of text.matchAll(DIRECT_INTL_RE)) {
      findings.push({ rule: 'direct-intl', file: rel, line: lineOf(text, match.index), message: `${match[0]} outside ${FORMATTERS_FILE}` });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 7: error-code-missing
// ---------------------------------------------------------------------------

/**
 * The codes listed in `ERROR_CODES`, read by scanning the array for quoted
 * words.
 *
 * Comments are stripped first (`stripComments` is a hoisted declaration in
 * the literal-string section below). Without that, one apostrophe in a
 * comment inside the array, as in "the user's home", desynchronises every
 * quote pair after it, and the check reports a hundred-odd findings naming
 * fragments of the file rather than the comment that caused them. Prose in
 * that array is allowed to be ordinary English.
 */
export function readErrorCodes(root) {
  const abs = path.join(root, ERRORS_TS);
  if (!existsSync(abs)) return [];
  const text = stripComments(readFileSync(abs, 'utf8'));
  const block = /ERROR_CODES\s*=\s*\[([\s\S]*?)\]/.exec(text);
  if (!block) return [];
  return [...block[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

export function checkErrorCodes(root) {
  const loaded = loadCatalogs(root);
  const errors = loaded.catalogs[SOURCE_LANGUAGE]?.errors;
  const file = fileFor(loaded, SOURCE_LANGUAGE, 'errors');
  const findings = [];
  if (!errors) {
    findings.push({ rule: 'error-code-missing', file, message: `no errors catalog for ${SOURCE_LANGUAGE}` });
    return findings;
  }
  if (typeof errors.generic !== 'string') {
    findings.push({ rule: 'error-code-missing', file, message: 'key "generic" is missing' });
  }
  for (const code of readErrorCodes(root)) {
    if (typeof errors[code] !== 'string') {
      findings.push({ rule: 'error-code-missing', file, message: `error code "${code}" has no entry` });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 8: literal-string
// ---------------------------------------------------------------------------

const ALLOW_LITERAL_MARKER = 'i18n-check: allow-literal';
const TEXT_ATTRIBUTES = new Set(['placeholder', 'title', 'aria-label', 'alt', 'content']);

/**
 * The TypeScript compiler, from the web package that depends on it: the
 * repository root has no dependency of its own on it, and the check runs as a
 * plain `node` script from the root. Loaded on first use.
 */
// stripComments is also what readErrorCodes reads the ERROR_CODES array
// through; it is a hoisted declaration for that reason.
function stripComments(text) {
  // Block comments become spaces of equal length so indexes and lines hold.
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

function hasLetters(text) {
  return /\p{L}/u.test(text.replace(/&[a-zA-Z]+;|&#\d+;/g, ' '));
}

function allowedByMarker(lines, line) {
  return (lines[line - 1] ?? '').includes(ALLOW_LITERAL_MARKER)
    || (lines[line - 2] ?? '').includes(ALLOW_LITERAL_MARKER);
}

/**
 * The literal text an expression can put on screen. It follows the value
 * through the branches of `?:`, both sides of `||` and `??`, the right side of
 * `&&`, `+` concatenation, parentheses and the literal parts of a template;
 * it never looks into a condition or into a call's arguments, so `t('key')`,
 * `kind === 'approve'` and `format('short')` are not text.
 */
function renderedLiterals(node, out) {
  const T = ts();
  if (T.isStringLiteral(node) || T.isNoSubstitutionTemplateLiteral(node)) {
    out.push({ node, text: node.text });
  } else if (T.isTemplateExpression(node)) {
    out.push({ node, text: [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ') });
  } else if (T.isParenthesizedExpression(node) || T.isAsExpression(node) || T.isNonNullExpression(node)) {
    renderedLiterals(node.expression, out);
  } else if (T.isConditionalExpression(node)) {
    renderedLiterals(node.whenTrue, out);
    renderedLiterals(node.whenFalse, out);
  } else if (T.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    const K = T.SyntaxKind;
    if (op === K.AmpersandAmpersandToken) renderedLiterals(node.right, out);
    else if (op === K.BarBarToken || op === K.QuestionQuestionToken || op === K.PlusToken) {
      renderedLiterals(node.left, out);
      renderedLiterals(node.right, out);
    }
  }
  return out;
}

/**
 * The name a call is made through: `addToast` for `addToast(...)`,
 * `store.addToast(...)`, `store?.addToast(...)` and
 * `useUIStore.getState().addToast(...)` alike.
 */
function calleeName(expression) {
  const T = ts();
  if (T.isIdentifier(expression)) return expression.text;
  if (T.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

/**
 * Literal user-facing text in one component file, read from its syntax tree:
 * JSX text anywhere (inside conditionals and maps too), literal values of the
 * text attributes whether quoted or computed, literal JSX children
 * (`{open ? 'Open' : t('x')}`), and literal first arguments of `addToast`,
 * called bare or through a store.
 */
function literalFindingsIn(rel, text) {
  const T = ts();
  const source = T.createSourceFile(rel, text, T.ScriptTarget.Latest, true, rel.endsWith('tsx') ? T.ScriptKind.TSX : T.ScriptKind.TS);
  const lines = text.split('\n');
  const findings = [];
  const push = (node, message) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    if (allowedByMarker(lines, line)) return;
    findings.push({ rule: 'literal-string', file: rel, line, message });
  };
  const pushRendered = (expression, describe) => {
    for (const { node, text: value } of renderedLiterals(expression, [])) {
      if (hasLetters(value)) push(node, `${describe} "${value.replace(/\s+/g, ' ').trim().slice(0, 60)}"`);
    }
  };

  const visit = (node) => {
    if (T.isJsxText(node)) {
      const visible = node.text.replace(/\s+/g, ' ').trim();
      if (hasLetters(visible)) push(node, `JSX text "${visible.slice(0, 60)}"`);
    } else if (T.isJsxAttribute(node)) {
      const name = node.name.getText(source);
      const init = node.initializer;
      if (TEXT_ATTRIBUTES.has(name) && init) {
        if (T.isStringLiteral(init)) pushRendered(init, `${name} attribute`);
        else if (T.isJsxExpression(init) && init.expression) pushRendered(init.expression, `${name} attribute`);
      }
    } else if (T.isJsxExpression(node) && node.expression && (T.isJsxElement(node.parent) || T.isJsxFragment(node.parent))) {
      pushRendered(node.expression, 'JSX child');
    } else if (T.isCallExpression(node) && calleeName(node.expression) === 'addToast') {
      const first = node.arguments[0];
      if (first) pushRendered(first, 'addToast literal');
    } else if (T.isObjectLiteralExpression(node)) {
      const properties = node.properties.filter(property => T.isPropertyAssignment(property));
      const type = properties.find(property => property.name.getText(source) === 'type')?.initializer;
      if (type && T.isStringLiteral(type) && ['action', 'checkbox', 'submenu'].includes(type.text)) {
        const label = properties.find(property => property.name.getText(source) === 'label')?.initializer;
        if (label) pushRendered(label, 'context-menu label');
      }
    }
    T.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

function loadPending(root) {
  const abs = path.join(root, PENDING_FILE);
  if (!existsSync(abs)) return [];
  return readFileSync(abs, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/**
 * Dev-only entries. Nothing under `src/dev/` is reachable from the app: each
 * file is the entry of its own workbench page, loaded by hand during design
 * work and never bundled into the product. Their copy addresses whoever is
 * building the component, so the literal-string rule does not apply to them.
 * Every other rule still does.
 */
function isDevHarness(rel) {
  return rel.startsWith(`${WEB_SRC_DIR}/dev/`);
}

function isComponentFile(rel) {
  return isSourceFile(rel) && !isDevHarness(rel);
}

export function checkLiteralStrings(root, options = {}) {
  const pending = new Set(options.pending ?? loadPending(root));
  const findings = [];
  for (const rel of walk(root, WEB_SRC_DIR, isComponentFile)) {
    if (pending.has(rel)) continue;
    findings.push(...literalFindingsIn(rel, readFileSync(path.join(root, rel), 'utf8')));
  }
  return findings;
}

/** Every component file that still has literal strings, ignoring the pending list. */
export function listLiteralStringFiles(root) {
  const files = [];
  for (const rel of walk(root, WEB_SRC_DIR, isComponentFile)) {
    if (literalFindingsIn(rel, readFileSync(path.join(root, rel), 'utf8')).length > 0) files.push(rel);
  }
  return files;
}

// ---------------------------------------------------------------------------
// Rule 9: markup
// ---------------------------------------------------------------------------

// html-parse-stringify (used by react-i18next's Trans component) parses these
// as HTML void elements. They cannot be used as wrappers for React components:
// `<link>text</link>`, for example, renders an empty <link> and leaves `text`
// outside the component supplied to Trans.
const HTML_VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
const MARKUP_TAG_RE = /<\/?([A-Za-z][\w-]*)\b[^>]*>/g;

function markupTagsOf(value) {
  const tags = new Set();
  for (const match of String(value).matchAll(MARKUP_TAG_RE)) tags.add(match[1]);
  return tags;
}

function pairedVoidTagsOf(value) {
  const text = String(value);
  const opening = new Set();
  const closing = new Set();
  for (const match of text.matchAll(MARKUP_TAG_RE)) {
    const full = match[0];
    // html-parse-stringify deliberately keeps this lookup case-sensitive, so
    // `<Link>` is a valid component name while lowercase `<link>` is void.
    const tag = match[1];
    if (!HTML_VOID_TAGS.has(tag)) continue;
    if (full.startsWith('</')) closing.add(tag);
    else if (!full.endsWith('/>')) opening.add(tag);
  }
  return new Set([...opening].filter((tag) => closing.has(tag)));
}

export function checkMarkup(root) {
  const loaded = loadCatalogs(root);
  const findings = [];
  const source = loaded.catalogs[SOURCE_LANGUAGE] ?? {};

  // Validate every catalog, including English: unsafe markup in the source is
  // just as capable of breaking a Trans component as a translator's change.
  for (const lng of loaded.languages) {
    for (const [ns, flat] of Object.entries(loaded.catalogs[lng] ?? {})) {
      for (const [key, value] of Object.entries(flat)) {
        for (const tag of pairedVoidTagsOf(value)) {
          findings.push({
            rule: 'markup',
            file: fileFor(loaded, lng, ns),
            message: `key "${key}" uses HTML void tag <${tag}> as a wrapper; use a non-HTML Trans component name`,
          });
        }
      }
    }
  }

  // Every provided form must retain its interactive markup, not merely the
  // family's union (which could conceal a broken singular form).
  for (const lng of loaded.languages) {
    if (lng === SOURCE_LANGUAGE) continue;
    for (const ns of loaded.namespaces) {
      const target = loaded.catalogs[lng]?.[ns];
      if (!target) continue;
      const sourceFamilies = families(source[ns]);
      const targetFamilies = families(target);
      for (const [base, sourceForms] of sourceFamilies) {
        const targetForms = targetFamilies.get(base);
        if (!targetForms) continue;
        const expected = new Set();
        for (const value of sourceForms.values()) for (const tag of markupTagsOf(value)) expected.add(tag);
        for (const [form, value] of targetForms) {
          const actual = markupTagsOf(value);
          if (!sameSet(expected, actual)) findings.push({
            rule: 'markup',
            file: fileFor(loaded, lng, ns),
            message: `key "${base}${form ? `_${form}` : ''}" uses <${[...actual].join('>, <')}> in ${lng} but <${[...expected].join('>, <')}> in ${SOURCE_LANGUAGE}`,
          });
        }
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// All together
// ---------------------------------------------------------------------------

export const RULES = [
  'catalog-value',
  'language-registry',
  'native-catalog',
  'parity',
  'placeholders',
  'plural-forms',
  'count-without-plural',
  'untranslated',
  'direct-intl',
  'error-code-missing',
  'literal-string',
  'markup',
];

export function runAllChecks(root, options = {}) {
  const loaded = loadCatalogs(root);
  const registry = readLanguageRegistry(root);
  const known = registry.entries.length ? registry.entries.map(entry => entry.code) : loaded.languages;
  const registryFindings = [...registry.findings];
  for (const language of [...loaded.languages, ...(options.locales ?? [])]) {
    if (!known.includes(language)) registryFindings.push({ rule: 'language-registry', file: LOCALES_DIR, message: `Unknown language "${language}"` });
  }
  return [
    ...loaded.findings,
    ...checkDuplicateCatalogKeys(root, loaded),
    ...registryFindings,
    ...checkParity(root, options),
    ...checkPlaceholders(root),
    ...checkPluralForms(root),
    ...checkCountWithoutPlural(root),
    ...checkUntranslated(root, options),
    ...checkDirectIntl(root),
    ...checkErrorCodes(root),
    ...checkLiteralStrings(root, options),
    ...checkMarkup(root),
    ...(options.includeDesktop ? checkDesktopCatalogs(root, options, registry) : []),
  ];
}

function checkDuplicateCatalogKeys(root, loaded) {
  const findings = [];
  const T = ts();
  for (const namespaces of Object.values(loaded.files)) for (const file of Object.values(namespaces)) {
    const source = T.parseJsonText(file, readFileSync(path.join(root, file), 'utf8'));
    function visit(node) {
      if (T.isObjectLiteralExpression(node)) {
        const seen = new Set();
        for (const property of node.properties) {
          if (!T.isPropertyAssignment(property)) continue;
          const key = property.name.text;
          if (seen.has(key)) findings.push({ rule: 'catalog-value', file, line: source.getLineAndCharacterOfPosition(property.getStart(source)).line + 1, message: `Duplicate JSON property "${key}" would discard earlier copy` });
          seen.add(key);
        }
      }
      T.forEachChild(node, visit);
    }
    visit(source);
  }
  return findings;
}

function readLanguageRegistry(root) {
  const file = 'packages/web/src/i18n/languages.ts';
  if (!existsSync(path.join(root, file))) return { entries: [], findings: [] };
  try {
    const entries = readLiteralBinding(readFileSync(path.join(root, file), 'utf8'), file, 'supportedLanguages');
    if (!Array.isArray(entries) || !entries.length || entries.some(entry => !entry || typeof entry.code !== 'string'
      || !/^[a-z]{2}(?:-[A-Za-z0-9]+)*$/.test(entry.code) || !requiredPluralForms(entry.code)
      || typeof entry.nativeName !== 'string' || !entry.nativeName.trim() || !['ltr', 'rtl'].includes(entry.dir) || typeof entry.released !== 'boolean')
      || new Set(entries.map(entry => entry.code)).size !== entries.length || !entries.some(entry => entry.code === 'en' && entry.released)) throw new Error('Invalid/duplicate registry entries or missing released English');
    return { entries, findings: [] };
  } catch (error) {
    return { entries: [], findings: [{ rule: 'language-registry', file, message: error.message }] };
  }
}

function isAllowedTranslation(allowlist, language, namespace, key, value) {
  return allowlist.some(entry => typeof entry === 'string' ? entry === value : entry && typeof entry.reason === 'string' && entry.reason.trim()
    && entry.language === language && entry.namespace === namespace && entry.key === key && entry.value === value);
}

function checkDesktopCatalogs(root, options, registry) {
  const { catalogs, findings } = readDesktopCatalogs(root);
  const declared = registry.entries.map(entry => entry.code);
  const known = declared.length ? declared : [...new Set(catalogs.map(catalog => catalog.language))];
  const coverage = options.locales ?? known;
  const allowlist = options.allowlist ?? loadAllowlist(root);
  const placeholderSet = value => new Set([...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]));
  for (const surface of ['main', 'recovery', 'instancePicker']) {
    const source = catalogs.find(catalog => catalog.surface === surface && catalog.language === 'en');
    const file = surface === 'main' ? 'packages/desktop/src/l10n.ts' : `packages/desktop/resources/${surface === 'instancePicker' ? 'instance-picker' : surface}.html`;
    if (!source || !Object.keys(source.values).length) { findings.push({ rule: 'native-catalog', file, message: 'Native English source is missing/empty' }); continue; }
    for (const language of new Set([...known, ...catalogs.filter(catalog => catalog.surface === surface).map(catalog => catalog.language)])) {
      if (language === 'en') continue;
      const target = catalogs.find(catalog => catalog.surface === surface && catalog.language === language);
      if (!known.includes(language)) findings.push({ rule: 'language-registry', file, message: `Unknown native language "${language}"` });
      if (options.strict && coverage.includes(language)) for (const key of Object.keys(source.values)) {
        if (!Object.hasOwn(target?.values ?? {}, key)) findings.push({ rule: 'native-catalog', file, message: `${language}:${key} is missing` });
      }
      for (const [key, value] of Object.entries(target?.values ?? {})) {
        const english = source.values[key];
        if (english === undefined) findings.push({ rule: 'native-catalog', file, message: `${language}:${key} has no English source` });
        else {
          if (!sameSet(placeholderSet(english), placeholderSet(value))) findings.push({ rule: 'placeholders', file, message: `${language}:${key} has invalid native placeholders` });
          if (value === english && /\p{L}/u.test(value.replace(/\{\w+\}/g, ''))
            && !isAllowedTranslation(allowlist, language, `native.${surface}`, key, value)) findings.push({ rule: 'untranslated', file, message: `${language}:${key} is identical to English` });
        }
      }
    }
  }
  if (declared.length && existsSync(path.join(root, 'packages/desktop/src/l10n.ts'))) {
    const file = 'packages/desktop/src/l10n.ts';
    try {
      const text = readFileSync(path.join(root, file), 'utf8');
      for (const [binding, expected] of [['DESKTOP_LANGUAGES', declared], ['RELEASED_DESKTOP_LANGUAGES', registry.entries.filter(entry => entry.released).map(entry => entry.code)]]) {
        const codes = readLiteralBinding(text, file, binding);
        if (!Array.isArray(codes) || codes.length !== new Set(codes).size || !sameSet(new Set(codes), new Set(expected))) findings.push({ rule: 'language-registry', file, message: `${binding} differs from the web registry` });
      }
    } catch (error) { findings.push({ rule: 'language-registry', file, message: error.message }); }
  }
  const mainFile = 'packages/desktop/src/main.ts';
  if (existsSync(path.join(root, mainFile))) {
    const T = ts();
    const source = T.createSourceFile(mainFile, readFileSync(path.join(root, mainFile), 'utf8'), T.ScriptTarget.Latest, true, T.ScriptKind.TS);
    function visit(node) {
      if (T.isCallExpression(node) && T.isIdentifier(node.expression) && node.expression.text === 'showNotification') {
        for (const argument of node.arguments.slice(0, 2)) for (const value of renderedLiterals(argument, [])) {
          if (hasLetters(value.text)) findings.push({ rule: 'literal-string', file: mainFile, line: source.getLineAndCharacterOfPosition(value.node.getStart(source)).line + 1, message: 'Native notification copy must use the catalog' });
        }
      }
      T.forEachChild(node, visit);
    }
    visit(source);
  }
  return findings;
}

export function formatFinding(finding) {
  const where = finding.line ? `${finding.file}:${finding.line}` : finding.file;
  return `${where} ${finding.rule}: ${finding.message}`;
}

export function sortFindings(findings) {
  return [...findings].sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if ((a.line ?? 0) !== (b.line ?? 0)) return (a.line ?? 0) - (b.line ?? 0);
    if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });
}

export function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
