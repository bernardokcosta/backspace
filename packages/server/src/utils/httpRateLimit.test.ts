import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerHttpRateLimits } from './httpRateLimit.js';

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); vi.unstubAllEnvs(); });

async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.headers.authorization;
  if (!token?.startsWith('Bearer account-')) { reply.code(401).send({ code: 'unauthorized' }); return; }
  request.userId = token.slice(7);
}

async function fixture() {
  const app = Fastify(); apps.push(app);
  await registerHttpRateLimits(app);
  app.get('/api/probe', { preHandler: authenticate }, async () => ({ ok: true }));
  app.get('/assets/:id', async () => 'asset');
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/ws', async () => ({ ok: true }));
  app.get('/api/files/:id', async () => ({ ok: true }));
  await app.register(async child => {
    child.addHook('preHandler', authenticate);
    child.post('/api/plugin-auth', { config: { rateLimit: { max: 2, timeWindow: 60_000 } } }, async () => ({ ok: true }));
  });
  app.post('/api/route-auth', { preHandler: [authenticate], config: { rateLimit: { max: 2, timeWindow: 60_000 } } }, async () => ({ ok: true }));
  return app;
}

describe('HTTP request budgets', () => {
  it('admits twenty normal sessions sharing one address, including cold assets', async () => {
    const app = await fixture();
    for (let account = 0; account < 20; account++) {
      const headers = { authorization: `Bearer account-${account}` };
      expect((await app.inject('/ws')).statusCode).toBe(200);
      for (let asset = 0; asset < 60; asset++) expect((await app.inject(`/assets/${account}-${asset}`)).statusCode).toBe(200);
      for (let read = 0; read < 20; read++) expect((await app.inject({ url: '/api/probe', headers })).statusCode).toBe(200);
    }
  });

  it.each(['/api/plugin-auth', '/api/route-auth'])('charges verified identity after auth at %s', async url => {
    const app = await fixture();
    const post = (account: string) => app.inject({ method: 'POST', url, headers: { authorization: `Bearer account-${account}` } });
    expect((await post('alice')).statusCode).toBe(200);
    expect((await post('alice')).statusCode).toBe(200);
    expect((await post('alice')).statusCode).toBe(429);
    expect((await post('bob')).statusCode).toBe(200);
    for (let i = 0; i < 5; i++) expect((await app.inject({ method: 'POST', url, headers: { authorization: 'forged' } })).statusCode).toBe(401);
    expect((await post('bob')).statusCode).toBe(200);
  });

  it('an exhausted reader does not block another account, assets, uploads, health or admission', async () => {
    const app = await fixture();
    for (let i = 0; i < 1200; i++) expect((await app.inject({ url: '/api/probe', headers: { authorization: 'Bearer account-alice' } })).statusCode).toBe(200);
    const refused = await app.inject({ url: '/api/probe', headers: { authorization: 'Bearer account-alice' } });
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ code: 'rate_limited', rateLimitScope: 'http' });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    for (const url of ['/api/probe', '/api/health', '/assets/next', '/ws', '/api/files/upload']) {
      expect((await app.inject({ url, headers: { authorization: 'Bearer account-bob' } })).statusCode).toBe(200);
    }
  });

  it('keeps an early bounded defense and normalizes IPv6 at subnet scope', async () => {
    const app = await fixture();
    for (let i = 0; i < 5000; i++) await app.inject({ url: '/api/probe', remoteAddress: `2001:db8:1:2::${(i % 100 + 1).toString(16)}` });
    const refused = await app.inject({ url: '/api/probe', remoteAddress: '2001:db8:1:2::ff', headers: { authorization: 'Bearer account-bob' } });
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ rateLimitScope: 'transport' });
    expect((await app.inject({ url: '/api/health', remoteAddress: '2001:db8:1:2::ff' })).statusCode).toBe(200);
  });
});
