import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const desktop = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(desktop, 'package.json'));
for (const name of ['preload', 'userDataMigration', 'deepLinks', 'languageIpc']) {
  if (!fs.existsSync(path.join(desktop, 'dist', name + '.js'))) throw new Error('Compile desktop TypeScript before the rebrand smoke test');
}
const temp = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : os.tmpdir();
const directory = fs.mkdtempSync(path.join(temp, 'veyvox-rebrand-smoke-'));
const historical = path.join(directory, 'appData', '@backspace', 'desktop');
fs.mkdirSync(historical, { recursive: true });
fs.writeFileSync(path.join(historical, 'language.json'), JSON.stringify({ language: 'auto' }));
const html = fs.readFileSync(path.join(desktop, 'test/rebrand/fixture.html'));
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (!['/fixture', '/foreign', '/favicon.ico'].includes(pathname)) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html);
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No loopback address');
const origin = `http://127.0.0.1:${address.port}`;
fs.writeFileSync(path.join(historical, 'instance-url.json'), JSON.stringify({ url: origin }));
// Production preload, with a fixture-only reporting operation appended. It is
// never included in product resources and exposes no general-purpose IPC.
const preload = path.join(directory, 'fixture-preload.cjs');
fs.writeFileSync(preload, fs.readFileSync(path.join(desktop, 'dist/preload.js'), 'utf8')
  + '\nconst {contextBridge: reportBridge, ipcRenderer: reportIpc} = require("electron");\nreportBridge.exposeInMainWorld("__rebrandReport", {send: value => reportIpc.send("rebrand-fixture-report", value)});\n');
const results = [];
try {
  for (const phase of ['seed', 'migrate', 'repeat']) {
    const log = fs.openSync(path.join(directory, `${phase}.log`), 'wx');
    const env = { ...process.env, NODE_ENV: 'test', VEYVOX_SMOKE_DIR: directory, VEYVOX_SMOKE_PHASE: phase, VEYVOX_SMOKE_ORIGIN: origin, VEYVOX_SMOKE_PRELOAD: preload };
    delete env.ELECTRON_RUN_AS_NODE;
    let timeout;
    const child = spawn(require('electron'), [path.join(desktop, 'test/rebrand/main.cjs')], { env, windowsHide: true, stdio: ['ignore', log, log] });
    try {
      const exit = await new Promise((resolve, reject) => {
        timeout = setTimeout(() => { child.kill(); reject(new Error(`Rebrand smoke timed out: ${phase}`)); }, 45000);
        child.once('error', reject); child.once('exit', resolve);
      });
      const report = path.join(directory, `${phase}.json`);
      if (!fs.existsSync(report)) throw new Error(`Missing ${phase} result (exit ${exit}); evidence: ${directory}`);
      const result = JSON.parse(fs.readFileSync(report, 'utf8'));
      if (exit !== 0 || result.status !== 'passed') throw new Error(`Rebrand ${phase} failed: ${result.error ?? 'process/report mismatch'}; evidence: ${directory}`);
      results.push(result);
    } finally { clearTimeout(timeout); fs.closeSync(log); }
  }
  console.log(JSON.stringify({ status: 'passed', results, evidence: directory, scope: 'isolated Electron/preload and actual Chromium profile migration; not installed-package acceptance' }, null, 2));
} finally { await new Promise(resolve => server.close(resolve)); }
