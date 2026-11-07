import { describe, it, expect, afterEach, vi } from 'vitest';
import { createApiClient, HttpError, RateLimitError } from './client';
import { describeError } from '../i18n/errors';
import { recordDiagnostic } from '../utils/diagnostics';

vi.mock('../utils/diagnostics', () => ({ recordDiagnostic: vi.fn() }));

const originalFetch = globalThis.fetch;

function answer(status: number, body: string | null, headers: Record<string, string> = {}): void {
  (globalThis.fetch as unknown) = vi.fn().mockResolvedValue(new Response(body, { status, headers }));
}

async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error('the request did not throw');
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

it('advertises memory support for Juno state and command on the selected origin only', async () => {
  answer(200, JSON.stringify({ revision: 1, game: null }));
  const client = createApiClient('https://remote.test', () => 'remote-token');
  await client.juno.get('remote voice');
  vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ revision: 2, game: null }), { status: 200 }));
  await client.juno.command('remote voice', { type: 'create' });
  expect(globalThis.fetch).toHaveBeenNthCalledWith(1, 'https://remote.test/api/channels/remote%20voice/juno?memory=1', expect.objectContaining({ method: 'GET' }));
  expect(globalThis.fetch).toHaveBeenNthCalledWith(2, 'https://remote.test/api/channels/remote%20voice/juno?memory=1', expect.objectContaining({ method: 'POST', body: JSON.stringify({ type: 'create' }) }));
});

it('routes Juno ranking through the selected origin with encoded space and pagination', async () => {
  answer(200, JSON.stringify({ spaceId: 'remote space', entries: [] }));
  const client = createApiClient('https://remote.test', () => 'remote-token');
  await client.juno.ranking('remote space', { limit: 10, offset: 20 });
  expect(globalThis.fetch).toHaveBeenCalledWith('https://remote.test/api/spaces/remote%20space/juno/ranking?limit=10&offset=20', expect.objectContaining({ method: 'GET' }));
});

describe('privacy-safe API diagnostics', () => {
  const client = createApiClient('https://home.test', () => 'private-token');

  it.each([403, 429])('retains the wire error code for HTTP %s without the error body', async status => {
    answer(status, JSON.stringify({ code: 'missing_permission', error: 'private message', details: { permission: 'private' } }));
    await thrownBy(() => client.users.me());
    expect(recordDiagnostic).toHaveBeenCalledWith({ event: 'api-failed', subsystem: 'api', level: 'warning',
      method: 'GET', route: '/users/@me', status, errorCode: 'missing_permission' });
    expect(JSON.stringify(vi.mocked(recordDiagnostic).mock.calls)).not.toMatch(/private/);
  });

  it('drops unknown response codes and still reports invalid error bodies', async () => {
    answer(500, JSON.stringify({ code: 'private-input', error: 'private message' }));
    await thrownBy(() => client.users.me());
    expect(recordDiagnostic).toHaveBeenLastCalledWith(expect.not.objectContaining({ errorCode: 'private-input' }));
    answer(502, 'not JSON');
    await thrownBy(() => client.users.me());
    expect(recordDiagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ status: 502 }));
  });
});

describe('a 429 answer', () => {
  const client = createApiClient('https://home.test', () => null);

  it('is a RateLimitError that is also an HttpError carrying the rate_limited code', async () => {
    answer(429, JSON.stringify({ error: 'Too many requests', code: 'rate_limited', statusCode: 429, retryAfter: 17 }), {
      'content-type': 'application/json',
      'retry-after': '17',
    });
    const err = await thrownBy(() => client.users.me());
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err).toBeInstanceOf(HttpError);
    const limited = err as RateLimitError;
    expect(limited.name).toBe('RateLimitError');
    expect(limited.status).toBe(429);
    expect(limited.code).toBe('rate_limited');
    expect(limited.retryAfter).toBe(17);
    expect(limited.message).toBe('Too many requests');
  });

  it('keeps the server\'s own 429 code so its catalog text is reachable', async () => {
    answer(429, JSON.stringify({ error: 'Too many lookups', code: 'lookup_rate_limited', statusCode: 429, retryAfter: 60 }), {
      'content-type': 'application/json',
    });
    const err = (await thrownBy(() => client.users.me())) as RateLimitError;
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.code).toBe('lookup_rate_limited');
    expect(err.retryAfter).toBe(60);
    expect(describeError(err)).toBe('Too many lookups. Try again in a minute.');
  });

  it('keeps details from the body when there are any', async () => {
    answer(429, JSON.stringify({ error: 'Too many requests', code: 'rate_limited', statusCode: 429, retryAfter: 5, details: { max: 200 } }));
    const err = (await thrownBy(() => client.users.me())) as RateLimitError;
    expect(err.details).toEqual({ max: 200 });
  });

  it('with an empty body still reads retryAfter from the header', async () => {
    answer(429, null, { 'retry-after': '42' });
    const err = (await thrownBy(() => client.users.me())) as RateLimitError;
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfter).toBe(42);
  });

  it('with neither body nor header falls back to sixty seconds', async () => {
    answer(429, null);
    const err = (await thrownBy(() => client.users.me())) as RateLimitError;
    expect(err.retryAfter).toBe(60);
  });

  it('uses the soundboard JSON wait when a federated response hides Retry-After', async () => {
    answer(429, JSON.stringify({ code: 'rate_limited', statusCode: 429, retryAfter: 1 }));
    const err = await thrownBy(() => client.soundboard.play('space', 'sound', 'voice')) as RateLimitError;
    expect(err.retryAfter).toBe(1);
  });
});

describe('history after a cursor', () => {
  const client = createApiClient('https://home.test', () => null);

  it('sends the cursor and reports a page the server cut after it', async () => {
    answer(200, JSON.stringify([{ id: '11' }, { id: '12' }]), { 'x-backspace-paging': 'after' });
    const page = await client.channels.messagesAfter('chan-1', '10', 50);
    expect(page).toEqual({ messages: [{ id: '11' }, { id: '12' }], forward: true });
    const url = String((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(url).toBe('https://home.test/api/channels/chan-1/messages?after=10&limit=50');
  });

  it('reports the newest page of a server that ignored the cursor', async () => {
    answer(200, JSON.stringify([{ id: '90' }]));
    const page = await client.dm.messagesAfter('dm-1', '10', 50);
    expect(page).toEqual({ messages: [{ id: '90' }], forward: false });
    const url = String((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(url).toBe('https://home.test/api/dm/dm-1/messages?after=10&limit=50');
  });
});
