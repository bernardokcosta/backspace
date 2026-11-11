import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'check-standalone.mjs');

function tempRoot(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veyvox-standalone-check-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

function runCli(root, extra = []) {
  if (!extra.includes('--inventory')) {
    const inventory = path.join(root, 'docs/superpowers/reports/2026-11-10-standalone-inventory.json');
    fs.mkdirSync(path.dirname(inventory), { recursive: true });
    fs.writeFileSync(inventory, JSON.stringify(minimalInventory));
  }
  return spawnSync(process.execPath, [SCRIPT, '--root', root, ...extra], { encoding: 'utf8' });
}

const minimalInventory = [
  { path: 'packages/server/src/routes/federation.ts', kind: 'source', action: 'delete', symbols: ['federationRoutes'], reason: 't' },
  { path: 'packages/server/src/db/schema.ts', kind: 'schema', action: 'delete', symbols: ['home_instance'], reason: 't' },
  { path: 'packages/server/src/routes/auth.ts', kind: 'route', action: 'delete', symbols: ['POST /api/auth/attach-proof'], reason: 't' },
  { path: 'packages/shared/src/types.ts', kind: 'event', action: 'delete', symbols: ['dm_call_undeliverable'], reason: 't' },
];

test('the real repository obeys the exact standalone source inventory', async () => {
  const { findRetiredImplementation, REPO_ROOT, DEFAULT_INVENTORY } = await import('./check-standalone.mjs');
  const inventory = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, DEFAULT_INVENTORY), 'utf8'));
  assert.deepEqual(findRetiredImplementation({ root: REPO_ROOT, inventory }), []);
});

test('rejectsRetiredImport produces path/symbol evidence and a nonzero CLI result', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const root = tempRoot({
    'packages/server/src/routes/chat.ts': `import { federationRoutes } from './federation.js';\nexport {};\n`,
  });
  try {
    const findings = findRetiredImplementation({ root, inventory: minimalInventory });
    assert.ok(findings.some(f => f.path.endsWith('chat.ts') && /federation/.test(f.symbol)), JSON.stringify(findings));
    const cli = runCli(root);
    assert.notEqual(cli.status, 0, cli.stdout + cli.stderr);
    assert.match(cli.stdout + cli.stderr, /chat\.ts/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejectsRouteAndEvent produces path/symbol evidence and a nonzero CLI result', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const root = tempRoot({
    'packages/server/src/routes/chat.ts': `app.post('/api/auth/attach-proof', () => {});\n`,
    'packages/shared/src/types.ts': `export type T = 'dm_call_undeliverable';\n`,
  });
  try {
    const findings = findRetiredImplementation({ root, inventory: minimalInventory });
    assert.ok(findings.some(f => /attach-proof/.test(f.symbol)), JSON.stringify(findings));
    assert.ok(findings.some(f => /dm_call_undeliverable/.test(f.symbol)), JSON.stringify(findings));
    const cli = runCli(root);
    assert.notEqual(cli.status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejectsWorkerRegistrationAndSchemaField produces path/symbol evidence and a nonzero CLI result', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const inventory = [
    ...minimalInventory,
    { path: 'packages/server/src/utils/federationWorker.ts', kind: 'source', action: 'delete', symbols: ['startFederationWorkers'], reason: 't' },
  ];
  const root = tempRoot({
    'packages/server/src/index.ts': `import { startFederationWorkers } from './utils/federationWorker.js';\nstartFederationWorkers();\n`,
    'packages/server/src/db/schema.ts': `export const users = { home_instance: 'x' };\n`,
  });
  try {
    const findings = findRetiredImplementation({ root, inventory });
    assert.ok(findings.some(f => /startFederationWorkers/.test(f.symbol)), JSON.stringify(findings));
    assert.ok(findings.some(f => /home_instance/.test(f.symbol)), JSON.stringify(findings));
    const cli = runCli(root);
    assert.notEqual(cli.status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejectsFedCatalogNamespace produces path/symbol evidence and a nonzero CLI result', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const root = tempRoot({ 'packages/web/src/locales/en/federation.json': '{"a":1}\n' });
  try {
    const findings = findRetiredImplementation({ root, inventory: minimalInventory });
    assert.ok(findings.some(f => /federation\.json/.test(f.path)), JSON.stringify(findings));
    const cli = runCli(root);
    assert.notEqual(cli.status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejectsWildcardOrUnknownException produces path/symbol evidence and a nonzero CLI result', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const root = tempRoot({ 'packages/server/src/routes/chat.ts': `export {};\n` });
  const bad = [{ path: 'packages/server/src/*', kind: 'source', action: 'transition-only', symbols: [], reason: 'wildcard' }];
  try {
    const findings = findRetiredImplementation({ root, inventory: bad });
    assert.ok(findings.length > 0, 'expected invalid-exception finding');
    const invFile = path.join(root, 'inventory.json');
    fs.writeFileSync(invFile, JSON.stringify(bad));
    const cli = runCli(root, ['--inventory', invFile]);
    assert.notEqual(cli.status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejectsStaleEmittedModule produces path/symbol evidence and a nonzero CLI result', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const root = tempRoot({
    'packages/server/dist/routes/federation.js': `export const federationRoutes = 1;\n`,
    'packages/server/dist/index.js': `export {};\n`,
    'packages/shared/dist/index.js': `export {};\n`,
    'packages/web/dist/index.html': `<html></html>`,
  });
  try {
    const findings = findRetiredImplementation({ root, inventory: minimalInventory, artifacts: true });
    assert.ok(findings.some(f => /federation\.js/.test(f.path)), JSON.stringify(findings));
    const cli = runCli(root, ['--artifacts']);
    assert.notEqual(cli.status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('acceptsLocalLiveKitRemoteAndCurrentOrigin stays green on legitimate vocabulary', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const root = tempRoot({
    'packages/server/src/routes/chat.ts': `import { getPublicOrigin } from '../utils/publicOrigin.js';\nexport const livekitUrl = process.env.LIVEKIT_URL;\n// remote media participant on the current origin\n`,
    'packages/web/src/components/media.tsx': `export function RemoteTile({ url }: { url: string }) { return <video src={url} />; }\n`,
  });
  try {
    const findings = findRetiredImplementation({ root, inventory: minimalInventory });
    assert.deepEqual(findings, []);
    const cli = runCli(root);
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('allowsOnlyInventoriedHistory flags retired symbols outside the exact allowlist', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const root = tempRoot({
    'packages/server/src/routes/sneaky.ts': `app.post('/api/auth/attach-proof', () => {});\n`,
  });
  try {
    const findings = findRetiredImplementation({ root, inventory: minimalInventory });
    assert.ok(findings.some(f => f.path.endsWith('sneaky.ts')), JSON.stringify(findings));
    const cli = runCli(root);
    assert.notEqual(cli.status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unknown test files cannot hide a reintroduced route or worker', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const root = tempRoot({ 'packages/server/src/routes/new.test.ts': "app.post('/api/auth/attach-proof', () => {});" });
  try { assert.ok(findRetiredImplementation({ root, inventory: minimalInventory }).some(f => f.path.endsWith('new.test.ts'))); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an exact inventoried negative fixture permits data, never runtime imports or calls', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const file = 'packages/server/src/routes/negative.test.ts';
  const inventory = [...minimalInventory, { path: file, kind: 'test', action: 'simplify', symbols: ['dm_call_undeliverable'], reason: 'Native negative event fixture' }];
  const root = tempRoot({ [file]: "expect(event).not.toHaveProperty('dm_call_undeliverable');" });
  try {
    assert.deepEqual(findRetiredImplementation({ root, inventory }), []);
    fs.writeFileSync(path.join(root, file), "import './federation.js';");
    assert.ok(findRetiredImplementation({ root, inventory }).some(f => /import/.test(f.reason)));
    fs.writeFileSync(path.join(root, file), 'federationRoutes(app);');
    assert.ok(findRetiredImplementation({ root, inventory }).some(f => f.symbol === 'federationRoutes'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('only exact historical files are exempt, not a docs directory', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const old = 'docs/decisions/old.md', unlisted = 'docs/decisions/unlisted.md';
  const inventory = [...minimalInventory, { path: old, kind: 'history', action: 'retain', symbols: ['federationRoutes'], reason: 'Approved prior design' }];
  const root = tempRoot({ [old]: 'Historical federationRoutes design', [unlisted]: 'Use federationRoutes today' });
  try {
    const findings = findRetiredImplementation({ root, inventory });
    assert.ok(findings.some(f => f.path === unlisted)); assert.ok(!findings.some(f => f.path === old));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('rejects arbitrary action/history exceptions and traversal paths', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const root = tempRoot({ 'packages/server/src/live.ts': 'export {};' });
  try {
    for (const entry of [
      { path: 'packages/server/src/index.ts', kind: 'history', action: 'retain', symbols: [], reason: 'Hide production' },
      { path: 'packages/server/src/index.ts', kind: 'source', action: 'ignore', symbols: [], reason: 'Unknown action' },
      { path: '../outside.ts', kind: 'source', action: 'delete', symbols: [], reason: 'Escape' },
      { path: 'packages/server/src/[abc].ts', kind: 'source', action: 'delete', symbols: [], reason: 'Glob' },
      { path: 'packages/server/src', kind: 'source', action: 'retain', symbols: [], reason: 'Directory' },
    ]) assert.ok(findRetiredImplementation({ root, inventory: [entry] }).length, JSON.stringify(entry));
    assert.ok(findRetiredImplementation({ root, inventory: null }).length);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('transition exceptions cannot hide HTTPS/WebSocket or retired module imports', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const file = 'packages/server/src/db/retireFederation.ts';
  const inventory = [...minimalInventory, { path: file, kind: 'source', action: 'transition-only', symbols: ['retireFederationData'], reason: 'One-time local transition' }];
  const root = tempRoot({ [file]: "import https from 'node:https'; https.request('https://unused.invalid');" });
  try { assert.ok(findRetiredImplementation({ root, inventory }).some(f => /network/.test(f.reason))); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('rejects registered catalog namespace even when the physical catalog has not been added', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const root = tempRoot({ 'packages/web/src/i18n/resources.ts': "export const namespaces = ['common', 'federation'];" });
  try { assert.ok(findRetiredImplementation({ root, inventory: minimalInventory }).some(f => /namespace/.test(f.reason))); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('requires real artifact entrypoints rather than accepting arbitrary nonempty directories', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const root = tempRoot({ 'packages/shared/dist/junk.txt': 'x', 'packages/server/dist/junk.txt': 'x', 'packages/web/dist/junk.txt': 'x' });
  try { assert.ok(findRetiredImplementation({ root, inventory: minimalInventory, artifacts: true }).some(f => f.symbol === '(missing-output)')); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('finds retired worker symbols in current emitted chunks and in unlisted emitted tests', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const file = 'packages/web/dist/assets/reintroduced.js', unknownTest = 'packages/server/dist/new.test.js';
  const root = tempRoot({ [file]: 'federationRoutes(app);', [unknownTest]: "app.post('/api/auth/attach-proof',()=>{});" });
  try {
    const findings = findRetiredImplementation({ root, inventory: minimalInventory, artifacts: true });
    assert.ok(findings.some(f => f.path === file)); assert.ok(findings.some(f => f.path === unknownTest));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('template substitutions and escaped literals do not hide retired contracts', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const file = 'packages/server/src/new.ts';
  const root = tempRoot({ [file]: "db.prepare(`SELECT home_instance FROM users WHERE id = ${id}`); app.post('/api/auth/' + 'attach-proof', handler); const event = '\\u0064m_call_undeliverable';" });
  try {
    const findings = findRetiredImplementation({ root, inventory: minimalInventory });
    for (const symbol of ['home_instance', '/api/auth/attach-proof', 'dm_call_undeliverable']) assert.ok(findings.some(f => f.symbol === symbol), JSON.stringify(findings));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('fixed fixture data never grants permission to execute a retired worker', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const file = 'packages/server/src/negative.test.ts';
  const root = tempRoot({ [file]: 'federationRoutes(app);' });
  try {
    const inventory = [...minimalInventory, { path: file, kind: 'test', action: 'simplify', symbols: [], dataSymbols: ['federationRoutes'], reason: 'Attempt to hide worker' }];
    assert.ok(findRetiredImplementation({ root, inventory }).length);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI refuses missing or malformed inventory instead of silently using another inventory', () => {
  const root = tempRoot({ 'inventory.json': '{' });
  try {
    for (const file of ['inventory.json', 'missing.json']) assert.notEqual(runCli(root, ['--inventory', path.join(root, file)]).status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an allowed request fixture cannot register object-form or computed-method routes', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const file = 'packages/server/src/negative.test.ts';
  const inventory = [...minimalInventory, { path: file, kind: 'test', action: 'simplify', symbols: ['/api/auth/attach-proof'], reason: '404 request fixture only' }];
  const root = tempRoot({});
  try {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    for (const code of ["app.route({method:'POST',url:'/api/auth/attach-proof',handler});", "app['post']('/api/auth/attach-proof',handler);"]) {
      fs.writeFileSync(path.join(root, file), code);
      assert.ok(findRetiredImplementation({ root, inventory }).some(f => /registration/.test(f.reason)), code);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ambient module shims cannot conceal a retired implementation import', async () => {
  const { findRetiredImplementation } = await import('./check-standalone.mjs');
  const root = tempRoot({ 'packages/server/src/routes/shim.d.ts': "declare module './federation.js' {}" });
  try { assert.ok(findRetiredImplementation({ root, inventory: minimalInventory }).some(f => /import/.test(f.reason))); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});
