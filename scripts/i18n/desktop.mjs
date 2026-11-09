/** Static native/catalog inspection. Never imports or evaluates application code. */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let compiler;
export function getTypeScript() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  compiler ??= createRequire(path.join(root, 'packages/web/package.json'))('typescript');
  return compiler;
}

export function readLiteralBinding(text, file, name) {
  const T = getTypeScript();
  const source = T.createSourceFile(file, text, T.ScriptTarget.Latest, true, T.ScriptKind.TS);
  if (source.parseDiagnostics.length) throw new Error('Invalid catalog source syntax');
  const bindings = new Map();
  for (const statement of source.statements) {
    if (!T.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (T.isIdentifier(declaration.name) && declaration.initializer) bindings.set(declaration.name.text, declaration.initializer);
    }
  }
  const active = new Set();
  function binding(key) {
    if (!bindings.has(key) || active.has(key)) throw new Error(`Missing or cyclic literal binding "${key}"`);
    active.add(key);
    try { return literal(bindings.get(key)); } finally { active.delete(key); }
  }
  function literal(node) {
    if (T.isAsExpression(node) || T.isSatisfiesExpression(node) || T.isParenthesizedExpression(node)) return literal(node.expression);
    if (T.isIdentifier(node)) return binding(node.text);
    if (T.isStringLiteral(node) || T.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (node.kind === T.SyntaxKind.TrueKeyword) return true;
    if (node.kind === T.SyntaxKind.FalseKeyword) return false;
    if (node.kind === T.SyntaxKind.NullKeyword) return null;
    if (T.isNumericLiteral(node)) return Number(node.text);
    if (T.isArrayLiteralExpression(node)) return node.elements.map(literal);
    if (T.isObjectLiteralExpression(node)) {
      const object = Object.create(null);
      for (const property of node.properties) {
        if (T.isShorthandPropertyAssignment(property)) {
          if (Object.hasOwn(object, property.name.text)) throw new Error('Duplicate catalog property');
          object[property.name.text] = binding(property.name.text);
        } else if (T.isPropertyAssignment(property) && (T.isIdentifier(property.name) || T.isStringLiteral(property.name))) {
          if (Object.hasOwn(object, property.name.text)) throw new Error('Duplicate catalog property');
          object[property.name.text] = literal(property.initializer);
        } else throw new Error('Catalogs require literal named properties, not computed/spread/executable values');
      }
      return object;
    }
    throw new Error(`Non-literal catalog value at line ${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
  }
  return binding(name);
}

const surfaces = [
  ['main', 'packages/desktop/src/l10n.ts', 'DESKTOP_CATALOGS'],
  ['recovery', 'packages/desktop/resources/recovery.html', 'STRINGS'],
  ['instancePicker', 'packages/desktop/resources/instance-picker.html', 'STRINGS'],
];

export function readDesktopCatalogs(root) {
  const catalogs = [], findings = [];
  for (const [surface, file, name] of surfaces) {
    try {
      if (!existsSync(path.join(root, file))) throw new Error('Native catalog source is missing');
      const text = readFileSync(path.join(root, file), 'utf8');
      const code = file.endsWith('.html') ? [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi)].map(match => match[1]).join('\n') : text;
      const tables = readLiteralBinding(code, file, name);
      if (!tables || typeof tables !== 'object' || Array.isArray(tables)) throw new Error('Expected a literal language-to-table map');
      for (const [language, values] of Object.entries(tables)) {
        if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error(`Invalid table for ${language}`);
        for (const [key, value] of Object.entries(values)) {
          if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid non-string/empty value for ${language}:${key}`);
        }
        catalogs.push({ surface, language, file, values });
      }
      if (file.endsWith('.html')) {
        const used = new Set([...text.matchAll(/\bdata-i18n\s*=\s*["']([^"']+)["']/g)].map(match => match[1]));
        const T = getTypeScript();
        const source = T.createSourceFile(file, code, T.ScriptTarget.Latest, true, T.ScriptKind.JS);
        function visit(node) {
          if (T.isCallExpression(node) && T.isIdentifier(node.expression) && node.expression.text === 't'
            && node.arguments[0] && T.isStringLiteral(node.arguments[0])) used.add(node.arguments[0].text);
          T.forEachChild(node, visit);
        }
        visit(source);
        for (const key of used) if (!Object.hasOwn(tables.en ?? {}, key)) findings.push({ rule: 'native-catalog', file, message: `Native call site "${key}" has no English source` });
      }
    } catch (error) {
      findings.push({ rule: 'native-catalog', file, message: error.message });
    }
  }
  return { catalogs, findings };
}
