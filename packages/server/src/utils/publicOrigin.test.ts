import { describe, expect, it, vi } from 'vitest';
const settings = vi.hoisted(() => ({ publicOrigin: undefined as string | undefined, domain: undefined as string | undefined, port: 3005 }));
vi.mock('../config.js', () => ({ config: settings }));
import { getPublicOrigin } from './publicOrigin.js';
describe('current instance public URL origin', () => {
  it('preserves an explicitly configured public scheme/host/port and removes trailing slash', () => {
    settings.publicOrigin = 'http://local.test:8443/'; settings.domain = 'domain.test';
    expect(getPublicOrigin()).toBe('http://local.test:8443');
  });
  it('uses the HTTPS domain without an override', () => {
    settings.publicOrigin = undefined; settings.domain = 'chat.test'; expect(getPublicOrigin()).toBe('https://chat.test');
  });
  it('uses the configured localhost port only for development fallback', () => {
    settings.publicOrigin = undefined; settings.domain = undefined; expect(getPublicOrigin()).toBe('http://localhost:3005');
  });
});
