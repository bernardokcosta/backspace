/** Exact standalone retirement inventory; inspect code, never execute it. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTypeScript } from './i18n/desktop.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_INVENTORY = 'docs/superpowers/reports/2026-11-10-standalone-inventory.json';
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const TEXT = /\.(?:[cm]?[jt]sx?|json|sql|md|ya?ml|html|sh|toml|env|example)$/;
const SCAN_DIRS = ['packages', 'scripts', 'docs', '.github', 'flatpak', 'deploy', 'patches'];
const ARTIFACTS = ['packages/shared/dist', 'packages/server/dist', 'packages/web/dist', 'packages/desktop/dist'];
const REQUIRED_OUTPUTS = ['packages/shared/dist/types.js', 'packages/server/dist/index.js', 'packages/web/dist/index.html'];
const TRANSITIONS = new Set([
  'packages/server/src/db/retireFederation.ts',
  'packages/server/src/db/retirementFiles.ts',
  'packages/web/src/platform/retireFederationStorage.ts',
  'packages/server/src/db/standalonePreflight.test.ts',
  'packages/server/src/db/retirementFiles.test.ts',
]);
// The checker, its executable fixture strings and its literal inventory describe
// the forbidden contracts by definition. No application file inherits this scope.
const SELF = new Set(['scripts/check-standalone.mjs', 'scripts/check-standalone.test.mjs', DEFAULT_INVENTORY]);
const KINDS = new Set(['config', 'history', 'test', 'source', 'schema', 'route', 'event', 'catalog']);
const ACTIONS = new Set(['delete', 'simplify', 'retain', 'transition-only']);
const GENERIC = new Set(['federation', 'federated', 'Federation', 'Federated', 'federate', 'Relay', 'Relayed', 'relay', 'Peering', 'peering', 'Peer', 'peer']);
const literalPath = value => typeof value === 'string' && value.length > 0 && !/[\\*?\[\]{}\x00-\x1f]/.test(value)
  && !path.posix.isAbsolute(value) && !/^[a-z]:/i.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
const isTest = file => /\.(?:test|spec)\./.test(file) || /\/(?:test|testing)\//.test(file);
const stem = file => file.replace(/\.(?:[cm]?[jt]sx?)$/, '');
const emitted = file => /\/src\//.test(file) ? stem(file.replace('/src/', '/dist/')) + '.js' : null;
const sourcePath = file => file.includes('/dist/') ? file.replace('/dist/', '/src/').replace(/\.js$/, '.ts') : file;
const specific = symbol => !GENERIC.has(symbol) && /^[A-Za-z_$][\w$]*$/.test(symbol)
  && (symbol.includes('_') || /[a-z][A-Z]/.test(symbol) || symbol.length >= 12);

function validateInventory(inventory) {
  const findings = [];
  if (!Array.isArray(inventory) || !inventory.length) return [{ path: '(inventory)', symbol: '(invalid-inventory)', reason: 'expected a nonempty inventory array' }];
  for (const entry of inventory) {
    const fail = reason => findings.push({ path: String(entry?.path ?? '(inventory)'), symbol: '(invalid-exception)', reason });
    if (!entry || !literalPath(entry.path) || !KINDS.has(entry.kind) || !ACTIONS.has(entry.action)
      || !Array.isArray(entry.symbols) || entry.symbols.some(s => typeof s !== 'string' || !s.trim())
      || typeof entry.reason !== 'string' || !entry.reason.trim()) { fail('inventory requires a literal file path, known kind/action, symbols and reason'); continue; }
    if (entry.kind === 'history' && (entry.action !== 'retain' || !(
      /^docs\/(?:decisions|superpowers\/(?:plans|specs|reports|validation))\/.*\.md$/.test(entry.path) || /^\.github\/release-notes\/v[\d.]+\.md$/.test(entry.path)
      || /^packages\/server\/drizzle\/(?:\d{4}_[\w-]+\.sql|meta\/(?:\d{4}_snapshot|_journal)\.json)$/.test(entry.path)
    ))) fail('history is only an exact documented decision/design/release or generated migration, never runtime code');
    if (entry.action === 'transition-only' && !TRANSITIONS.has(entry.path)) fail('unknown transition-only file');
    if (entry.dataSymbols !== undefined && (!Array.isArray(entry.dataSymbols) || entry.dataSymbols.some(s => typeof s !== 'string' || !s.trim())
      || !(entry.kind === 'test' || entry.action === 'transition-only' || entry.path === 'packages/server/src/testing/standaloneUpgrade.ts'))) fail('dataSymbols require an exact negative/old-schema fixture or transition');
    if (entry.kind === 'test' && !isTest(entry.path)) fail('test data exception must name an actual test file');
  }
  return findings;
}

function walk(root, dir, output, build = false) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return;
  for (const item of fs.readdirSync(full, { withFileTypes: true })) {
    const rel = path.posix.join(dir, item.name);
    if (item.isSymbolicLink()) continue;
    if (item.isDirectory()) {
      if (['node_modules', '.git', 'coverage'].includes(item.name) || (!build && item.name === 'dist')) continue;
      walk(root, rel, output, build);
    } else if (item.isFile() && TEXT.test(rel)) output.add(rel);
  }
}

export function findRetiredImplementation({ root, inventory, artifacts = false }) {
  const findings = validateInventory(inventory);
  if (findings.length) return findings;
  const add = (file, symbol, reason) => findings.push({ path: file, symbol, reason });
  for (const entry of inventory) {
    const file = path.join(root, entry.path);
    if (fs.existsSync(file) && !fs.statSync(file).isFile()) add(entry.path, '(invalid-exception)', 'inventory must name a literal file, never a directory');
  }
  if (findings.length) return findings;
  const records = new Map();
  for (const entry of inventory) {
    const rows = records.get(entry.path) ?? [];
    rows.push(entry); records.set(entry.path, rows);
  }
  const removed = inventory.filter(e => e.action === 'delete');
  const deletedFiles = removed.filter(e => ['source', 'test'].includes(e.kind)).map(e => e.path);
  const deletedStems = new Set(deletedFiles.map(stem));
  const schema = new Set(removed.filter(e => e.kind === 'schema').flatMap(e => e.symbols));
  const dataFields = new Set([...schema, ...[...schema].map(s => s.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())), 'federatedCallId']);
  for (const entry of inventory) for (const symbol of entry.dataSymbols ?? []) if (!dataFields.has(symbol)) add(entry.path, symbol, 'data exception must name a retired column/wire field, never a worker');
  if (findings.length) return findings;
  const symbols = new Set([...schema, ...removed.filter(e => ['source', 'event'].includes(e.kind)).flatMap(e => e.symbols).filter(specific)]);
  const routes = new Set(removed.filter(e => e.kind === 'route').flatMap(e => e.symbols).map(s => s.replace(/^[A-Z]+\s+/, '')));
  const events = new Set(removed.filter(e => e.kind === 'event').flatMap(e => e.symbols));
  const targets = [...new Set([...symbols, ...routes, ...events])];
  const matchers = targets.map(symbol => [symbol, /^[\w$]+$/.test(symbol) ? new RegExp(`(?<![\\w$])${symbol}(?![\\w$])`) : null]);
  const matching = value => matchers.filter(([symbol, regex]) => regex ? regex.test(value) : value.includes(symbol)).map(([symbol]) => symbol);
  for (const file of deletedFiles) if (fs.existsSync(path.join(root, file))) add(file, '(file-present)', 'retired implementation file still present');
  const files = new Set();
  for (const dir of SCAN_DIRS) walk(root, dir, files);
  for (const item of fs.readdirSync(root, { withFileTypes: true })) if (item.isFile() && (TEXT.test(item.name) || ['Dockerfile', 'Caddyfile'].includes(item.name))) files.add(item.name);
  for (const entry of inventory) if (fs.existsSync(path.join(root, entry.path))) files.add(entry.path);
  if (artifacts) {
    for (const file of REQUIRED_OUTPUTS) if (!fs.existsSync(path.join(root, file)) || !fs.statSync(path.join(root, file)).isFile() || !fs.statSync(path.join(root, file)).size) add(file, '(missing-output)', 'required build entrypoint missing; rebuild before artifact check');
    for (const dir of ARTIFACTS) walk(root, dir, files, true);
    for (const file of deletedFiles) {
      const js = emitted(file);
      if (js && fs.existsSync(path.join(root, js))) add(js, '(stale-emitted-module)', 'retired module survives as emitted JS');
    }
  }
  const T = getTypeScript();
  for (const file of [...files].sort()) {
    if (SELF.has(file)) continue;
    const original = sourcePath(file);
    const rows = records.get(original) ?? [];
    const history = rows.find(e => e.kind === 'history' && e.action === 'retain');
    if (history) continue;
    const transition = rows.some(e => e.action === 'transition-only');
    const data = new Set(rows.flatMap(e => e.dataSymbols ?? []));
    const literals = new Set(rows.filter(e => e.kind === 'test' && e.action !== 'delete').flatMap(e => e.symbols));
    for (const symbol of data) literals.add(symbol);
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    if (/(?:^|\/)federation\.json$/.test(file)) add(file, 'federation', 'retired catalog namespace still present');
    if (!CODE.test(file)) {
      for (const symbol of matching(text)) if (!literals.has(symbol)) add(file, symbol, 'retired contract in current config/resource/documentation');
      continue;
    }
    const source = T.createSourceFile(file, text, T.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? T.ScriptKind.TSX : /\.[cm]?jsx?$/.test(file) ? T.ScriptKind.JS : T.ScriptKind.TS);
    if (source.parseDiagnostics.length) { add(file, '(syntax)', 'cannot statically inspect malformed source'); continue; }
    const stringValue = node => node && (T.isStringLiteral(node) || T.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
    function constantText(node) {
      if (T.isBinaryExpression(node) && node.operatorToken.kind === T.SyntaxKind.PlusToken) {
        const left = constantText(node.left), right = constantText(node.right);
        return left !== null && right !== null ? left + right : null;
      }
      return stringValue(node);
    }
    function importSpecifier(node) {
      if (T.isModuleDeclaration(node)) return stringValue(node.name);
      if (T.isImportDeclaration(node) || T.isExportDeclaration(node)) return stringValue(node.moduleSpecifier);
      if (T.isImportEqualsDeclaration(node) && T.isExternalModuleReference(node.moduleReference)) return stringValue(node.moduleReference.expression);
      if (T.isCallExpression(node) && (node.expression.kind === T.SyntaxKind.ImportKeyword || T.isIdentifier(node.expression) && node.expression.text === 'require'
        || T.isPropertyAccessExpression(node.expression) && ['mock', 'doMock', 'importActual', 'requireActual'].includes(node.expression.name.text))) return stringValue(node.arguments[0]);
      return null;
    }
    function visit(node) {
      if (T.isCallExpression(node)) {
        const expression = node.expression;
        const method = T.isPropertyAccessExpression(expression) ? expression.name.text
          : T.isElementAccessExpression(expression) ? stringValue(expression.argumentExpression) : null;
        let argument = node.arguments[0];
        if (method === 'route' && argument && T.isObjectLiteralExpression(argument)) argument = argument.properties.find(property =>
          T.isPropertyAssignment(property) && (T.isIdentifier(property.name) ? property.name.text : stringValue(property.name)) === 'url')?.initializer;
        if (argument && ['get', 'post', 'put', 'patch', 'delete', 'route', 'on', 'once', 'addListener', 'addEventListener'].includes(method)) {
          const value = constantText(argument);
          if (value !== null) for (const symbol of matching(value)) if (routes.has(symbol) || events.has(symbol)) add(file, symbol, 'retired route/event registration');
        }
      }
      const specifier = importSpecifier(node);
      if (specifier !== null) {
        const clean = specifier.split(/[?#]/)[0];
        const resolved = clean.startsWith('.') ? stem(path.posix.normalize(path.posix.join(path.posix.dirname(original), clean)))
          : clean.startsWith('@veyvox/') ? stem('packages/' + clean.slice('@veyvox/'.length)) : null;
        if (resolved && (deletedStems.has(resolved) || deletedStems.has(resolved + '/index'))) add(file, specifier, 'retired module import/export/mock');
        if (transition && /^(?:node:)?(?:https?|http2|net|tls|dgram)$|^(?:undici|ws|axios|got|node-fetch)(?:\/|$)/.test(clean)) add(file, specifier, 'transition must not import network transport');
      }
      if (T.isIdentifier(node)) {
        const name = node.text;
        // dataSymbols permit only old columns/properties, never reactivating a
        // retired function, import, export or worker from a negative fixture.
        const parent = node.parent;
        const field = T.isPropertyAssignment(parent) && parent.name === node || T.isPropertySignature(parent) && parent.name === node
          || T.isPropertyAccessExpression(parent) && parent.name === node;
        if (symbols.has(name) && !(field && dataFields.has(name) && data.has(name))) add(file, name, 'retired identifier/worker referenced by executable code');
        if (transition && ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource'].includes(name)) add(file, name, 'transition must not open network transport');
      }
      const value = T.isTemplateHead(node) || T.isTemplateMiddle(node) || T.isTemplateTail(node) ? node.text : constantText(node);
      if (value !== null) {
        const parent = node.parent;
        const member = T.isElementAccessExpression(parent) && parent.argumentExpression === node
          || (T.isPropertyAssignment(parent) || T.isMethodDeclaration(parent)) && parent.name === node;
        const registration = T.isCallExpression(parent) && T.isPropertyAccessExpression(parent.expression)
          && ['get', 'post', 'put', 'patch', 'delete', 'route', 'on', 'once', 'addListener', 'addEventListener'].includes(parent.expression.name.text)
          && parent.arguments[0] === node;
        for (const symbol of matching(value)) if (!literals.has(symbol) || registration || member && !data.has(symbol)) add(file, symbol, 'retired route/event/schema contract in source');
        if (value === 'federation' && (file.includes('/i18n/') || /(?:namespaces|resources)/.test(file)) && (!literals.has(value) || registration || member)) add(file, value, 'retired catalog namespace registration');
      }
      T.forEachChild(node, visit);
    }
    visit(source);
  }
  return findings.filter((finding, index, all) => all.findIndex(other => other.path === finding.path && other.symbol === finding.symbol && other.reason === finding.reason) === index);
}

function main(argv) {
  const args = { root: REPO_ROOT, inventory: null, artifacts: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--artifacts') args.artifacts = true;
    else if (['--root', '--inventory'].includes(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('--')) args[argv[i].slice(2)] = path.resolve(argv[++i]);
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  const file = args.inventory ?? path.join(args.root, DEFAULT_INVENTORY);
  const inventory = JSON.parse(fs.readFileSync(file, 'utf8'));
  const findings = findRetiredImplementation({ ...args, inventory });
  for (const finding of findings) console.log(`FAIL ${finding.path} :: ${finding.symbol} :: ${finding.reason}`);
  if (findings.length) { console.error(`${findings.length} retired-implementation finding(s)`); process.exitCode = 1; }
  else console.log(`OK no retired implementation findings${args.artifacts ? ' (including artifacts)' : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`FAIL inventory/check :: ${error.message}`); process.exitCode = 2; }
}
