import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MESSAGE_PAGING_HEADER } from '@veyvox/shared';
import { bootInstance, type SpawnedInstance } from './helpers/instanceHarness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = path.resolve(__dirname, '../src');
const BROWSER_ORIGIN = 'https://browser.invalid';

describe('CORS posture', () => {
  let instance: SpawnedInstance, cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    ({ instance, cleanup } = await bootInstance());
  }, 120_000);

  afterAll(async () => {
    await cleanup?.();
  });

  it('supports a separately hosted client selecting this instance on login', async () => {
    const res = await fetch(`${instance.origin}/api/instance/info`, {
      headers: { Origin: BROWSER_ORIGIN },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(BROWSER_ORIGIN);
  });

  it('reflects Origin: null so the desktop picker can probe from file://', async () => {
    const res = await fetch(`${instance.origin}/api/instance/info`, {
      headers: { Origin: 'null' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('null');
  });

  it('never grants credentialed cross-origin access', async () => {
    const res = await fetch(`${instance.origin}/api/instance/info`, {
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('never grants credentialed access on a preflight either', async () => {
    const res = await fetch(`${instance.origin}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('has no ambient-credential mechanism anywhere in the server', async () => {
    // The reason a reflected origin is safe here is that there is nothing for a
    // cross-origin page to ride on: no cookies, no HTTP auth, tokens live in
    // localStorage and are attached explicitly. If that ever stops being true,
    // the whole posture in docs/systems/web-security.md has to be revisited,
    // so fail loudly rather than let it drift.
    // Native file traversal works with Windows/space-containing paths and must
    // fail on read errors, rather than `grep ... || true` silently passing.
    const forbidden = /setcookie|@fastify\/cookie|req(uest)?\.cookies|['"]set-cookie['"]/i;
    expect(forbidden.test('reply.setCookie("session", value)')).toBe(true);
    const files = (await readdir(SERVER_SRC, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile());
    const hits = (await Promise.all(files.map(async entry => {
      const filename = path.join(entry.parentPath, entry.name);
      return (await readFile(filename, 'utf8')).split('\n')
        .flatMap((line, index) => forbidden.test(line) ? [`${filename}:${index + 1}`] : []);
    }))).flat();
    expect(hits).toEqual([]);
  });

  it('declares the tus headers a separately hosted client needs', async () => {
    const res = await fetch(`${instance.origin}/api/files/probe`, {
      method: 'OPTIONS',
      headers: {
        Origin: BROWSER_ORIGIN,
        'Access-Control-Request-Method': 'PATCH',
        'Access-Control-Request-Headers': 'upload-offset,tus-resumable',
      },
    });
    const allowed = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    expect(allowed).toContain('upload-offset');
    expect(allowed).toContain('tus-resumable');
  });

  it('exposes the message paging header to a separately hosted browser', async () => {
    const res = await fetch(`${instance.origin}/api/instance/info`, {
      headers: { Origin: BROWSER_ORIGIN },
    });
    const exposed = (res.headers.get('access-control-expose-headers') ?? '').toLowerCase();
    expect(exposed).toContain(MESSAGE_PAGING_HEADER.toLowerCase());
  });

  it('serves a source file that documents why the origin stays reflected', async () => {
    const src = await readFile(path.join(SERVER_SRC, 'index.ts'), 'utf8');
    expect(src).toMatch(/bearer/i);
    expect(src).not.toMatch(/credentials:\s*true/);
  });
});
