import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DiagnosticLogStore, diagnosticLoggerStream, captureServerConsole } from './diagnosticLogs.js';

const directories: string[] = [];
function directory() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backspace-diagnostics-')); directories.push(dir); return dir; }
afterEach(() => { vi.restoreAllMocks(); for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('bounded diagnostic log storage', () => {
  it('rotates oldest records before append and applies the budget again on restart', () => {
    const dir = directory(); const log = new DiagnosticLogStore(dir, { maxBytes: 300, segmentBytes: 100 });
    for (let i = 0; i < 40; i++) log.append({ event: 'test', sequence: i });
    expect(log.stats().bytes).toBeLessThanOrEqual(300);
    const restarted = new DiagnosticLogStore(dir, { maxBytes: 120, segmentBytes: 100 });
    expect(restarted.stats().bytes).toBeLessThanOrEqual(120);
    const contents = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
    expect(contents).toContain('39'); expect(contents).not.toContain('"sequence":0');
  });
  it('drops oversized/unwritable records without throwing or touching unrelated files', () => {
    const dir = directory(); fs.writeFileSync(path.join(dir, 'operator-note.txt'), 'keep');
    const log = new DiagnosticLogStore(dir, { maxBytes: 200, segmentBytes: 100 });
    expect(log.append({ text: 'x'.repeat(300) })).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'operator-note.txt'), 'utf8')).toBe('keep');
    const blocked = path.join(dir, 'not-a-directory'); fs.writeFileSync(blocked, 'keep');
    expect(() => new DiagnosticLogStore(blocked).append({ ok: true })).not.toThrow();
  });
  it('normalizes logger records instead of retaining request data or exception messages', () => {
    const dir = directory(); const log = new DiagnosticLogStore(dir);
    diagnosticLoggerStream(log, () => {}).write(JSON.stringify({ level: 50, reqId: 'req-1', msg: 'private',
      req: { method: 'GET', url: '/api/users/private?token=secret', headers: { authorization: 'secret' } },
      err: { type: 'Error', message: 'secret', stack: 'Error: secret\n at /app/server.ts:1:2' }, res: { statusCode: 500 } }) + '\n');
    const contents = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
    expect(contents).toContain('server-log'); expect(contents).toContain('server.ts:1:2');
    expect(contents).not.toMatch(/secret|private|authorization|\/app\//);
  });
  it('refuses linked segments rather than writing through them', () => {
    const dir = directory(); const target = path.join(dir, 'operator-note.txt'); fs.writeFileSync(target, 'keep');
    fs.linkSync(target, path.join(dir, 'diagnostics-000000000000000.jsonl'));
    const log = new DiagnosticLogStore(dir);
    expect(log.append({ secret: 'must not be written' })).toBe(false);
    expect(fs.readFileSync(target, 'utf8')).toBe('keep');
  });
  it('drops disk failures instead of throwing or repeatedly attempting writes', () => {
    const log = new DiagnosticLogStore(directory());
    const append = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => { throw Object.assign(new Error('full'), { code: 'ENOSPC' }); });
    expect(log.append({ event: 'test' })).toBe(false); expect(log.append({ event: 'again' })).toBe(false);
    expect(append).toHaveBeenCalledOnce(); expect(log.stats()).toMatchObject({ available: false, writeFailures: 1, dropped: 2 });
  });
  it('retains safe CSP directives and console call sites without free text', () => {
    const dir = directory(); const log = new DiagnosticLogStore(dir); const output = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const restore = captureServerConsole(log, '1.15.9');
    try { console.warn('password=secret user=private', { private: 'message' }); } finally { restore(); }
    diagnosticLoggerStream(log, () => {}).write(JSON.stringify({ level: 40, csp: JSON.stringify({ 'csp-report': {
      'violated-directive': 'script-src', 'blocked-uri': 'https://private/?token=secret' } }) }));
    const contents = fs.readdirSync(dir).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
    expect(contents).toContain('script-src'); expect(contents).toContain('server-console'); expect(contents).not.toMatch(/private|secret/);
    expect(output).toHaveBeenCalledOnce();
  });
  it.each(['exception', 'rejection', 'string-rejection'])('sanitizes fatal %s output and still exits unsuccessfully', mode => {
    const dir = directory();
    const moduleUrl = new URL('./diagnosticLogs.ts', import.meta.url).href;
    const script = `import {DiagnosticLogStore, captureServerConsole, installFatalDiagnostics} from ${JSON.stringify(moduleUrl)};
      const store = new DiagnosticLogStore(${JSON.stringify(dir)});
      captureServerConsole(store); installFatalDiagnostics(store, '1.15.9');
      const message = 'password=CREDENTIAL_CANARY private MESSAGE_CANARY /CREDENTIAL_CANARY.js:12:34';
      ${mode === 'exception' ? 'setTimeout(() => { throw new Error(message); }, 0);'
        : mode === 'rejection' ? 'Promise.reject(new Error(message));' : 'Promise.reject(message);'}`;
    const result = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', script], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', timeout: 10_000,
    });
    expect(result.status, result.stderr).toBe(1);
    const output = result.stdout + result.stderr + fs.readdirSync(dir).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
    expect(output).toContain('server-log');
    expect(output).not.toMatch(/CREDENTIAL_CANARY|MESSAGE_CANARY/);
  });
});
