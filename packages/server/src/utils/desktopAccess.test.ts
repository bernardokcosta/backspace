import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { requireCompatibleDesktop, guardDesktopAccess, DesktopUpdateRequiredError } from './desktopAccess.js';
import { config } from '../config.js';

describe('verified-principal desktop compatibility seam', () => {
  it('rejects old and unknown desktop versions with an actionable 426 contract', () => {
    for (const ua of ['BackspaceFork/1.15.0 Electron/45.0.0', 'Electron/45.0.0', 'BackspaceFork/1.15.1-beta.1']) {
      try { requireCompatibleDesktop(ua, { isBot: false }, '1.15.1'); throw new Error('Expected refusal'); }
      catch (error) {
        expect(error).toBeInstanceOf(DesktopUpdateRequiredError);
        expect(error).toMatchObject({ statusCode: 426, code: 'desktop_update_required', details: { minimumVersion: '1.15.1' } });
        if (ua.startsWith('Electron')) expect((error as DesktopUpdateRequiredError).details).not.toHaveProperty('currentVersion');
      }
    }
  });
  it('preserves disabled policy, current desktops, browsers and verified bots', () => {
    for (const ua of [undefined, '', 'Mozilla/5.0 Chrome/156.0 Safari/537.36', 'Backspace-Federation/1.15.0', 'BackspaceFork/1.15.1', 'BackspaceFork/1.16.0']) {
      expect(() => requireCompatibleDesktop(ua, { isBot: false }, '1.15.1')).not.toThrow();
    }
    expect(() => requireCompatibleDesktop('Electron/45', { isBot: false }, null)).not.toThrow();
    expect(() => requireCompatibleDesktop('BackspaceFork/1.0.0', { isBot: true }, '1.15.1')).not.toThrow();
  });
  it('sends the standard error body without running a protected mutation', async () => {
    const previous = config.minimumDesktopVersion;
    (config as { minimumDesktopVersion: string | null }).minimumDesktopVersion = '1.15.1';
    const app = Fastify(); let writes = 0;
    app.post('/write', { preHandler: async (request, reply) => { guardDesktopAccess(request, reply, { isBot: false }); } }, async () => { writes++; return { ok: true }; });
    try {
      const old = await app.inject({ method: 'POST', url: '/write', headers: { 'user-agent': 'BackspaceFork/1.15.0' } });
      expect(old.statusCode).toBe(426);
      expect(old.json()).toMatchObject({ code: 'desktop_update_required', details: { minimumVersion: '1.15.1', currentVersion: '1.15.0' } });
      expect(writes).toBe(0);
      expect((await app.inject({ method: 'POST', url: '/write' })).statusCode).toBe(200);
      expect(writes).toBe(1);
    } finally { (config as { minimumDesktopVersion: string | null }).minimumDesktopVersion = previous; await app.close(); }
  });
});
