import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arch = args[args.indexOf('--arch') + 1];
const mode = args[args.indexOf('--mode') + 1];
if (args.length !== 4 || !['x64', 'arm64'].includes(arch) || !['synthetic', 'module'].includes(mode)) {
  throw new Error('Usage: node run-sdr-capture-smoke.mjs --arch x64|arm64 --mode synthetic|module');
}
if (process.platform !== 'win32' || process.arch !== arch) throw new Error(`Synthetic SDR smoke requires a matching Windows ${arch} host`);
const require = createRequire(path.join(directory, '../package.json'));
const electron = require('electron');
const native = path.resolve(directory, `../native/sdr-capture/build/win32-${arch}/sdr_capture.node`);
if (!fs.existsSync(native)) throw new Error('Build the matching native SDR module first');
if (!fs.existsSync(path.resolve(directory, '../dist/sdrCaptureTransport.js'))) throw new Error('Run the desktop TypeScript build before the SDR smoke test');
const tempRoot = path.join(process.env.LOCALAPPDATA ?? 'C:/Users/Public/AppData/Local', 'Temp/opencode');
fs.mkdirSync(tempRoot, { recursive: true });
const evidence = fs.mkdtempSync(path.join(tempRoot, 'sdr-capture-smoke-'));
const report = path.join(evidence, 'result.json');
const log = fs.openSync(path.join(evidence, 'electron.log'), 'wx');
const env = { ...process.env, BACKSPACE_SDR_SMOKE_DIR: evidence, BACKSPACE_SDR_NATIVE: native, BACKSPACE_SDR_SMOKE_MODE: mode };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.resolve(directory, '../test/sdr-capture/main.cjs'), '--enable-logging=file', `--log-file=${path.join(evidence, 'chromium.log')}`], { env, stdio: ['ignore', log, log], windowsHide: true });
let timeout;
try {
  const exit = await new Promise((resolve, reject) => {
    timeout = setTimeout(() => { child.kill(); reject(new Error(`Synthetic SDR smoke timed out; evidence: ${evidence}`)); }, 45000);
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (!fs.existsSync(report)) throw new Error(`Synthetic SDR smoke failed (exit ${exit}); evidence: ${evidence}`);
  const result = JSON.parse(fs.readFileSync(report, 'utf8'));
  if (exit !== 0 || result.status !== 'passed') throw new Error(`Synthetic SDR smoke failed (exit ${exit}): ${result.error}; evidence: ${evidence}`);
  console.log(JSON.stringify({ ...result, evidence }, null, 2));
} finally {
  clearTimeout(timeout);
  fs.closeSync(log);
}
