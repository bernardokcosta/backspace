import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// config.ts reads process.env at module load, so each case sets the variable
// and re-imports a fresh copy of the module.
async function loadConfig(): Promise<typeof import('./config.js')['config']> {
  vi.resetModules();
  const mod = await import('./config.js');
  return mod.config;
}

const saved = process.env.DIRECTORY_ENDPOINT;
const savedTelemetry = process.env.TELEMETRY_ENDPOINT;

beforeEach(() => {
  delete process.env.DIRECTORY_ENDPOINT;
  delete process.env.TELEMETRY_ENDPOINT;
});

afterEach(() => {
  if (saved === undefined) delete process.env.DIRECTORY_ENDPOINT;
  else process.env.DIRECTORY_ENDPOINT = saved;
  if (savedTelemetry === undefined) delete process.env.TELEMETRY_ENDPOINT;
  else process.env.TELEMETRY_ENDPOINT = savedTelemetry;
});

describe('retired directory configuration', () => {
  it.each([undefined, '', 'https://legacy.example/', 'not a URL'])('has no directory config with legacy endpoint %s', async (value) => {
    if (value !== undefined) process.env.DIRECTORY_ENDPOINT = value;
    expect(await loadConfig()).not.toHaveProperty('directory');
  });
});

describe('retired telemetry configuration', () => {
  it.each([undefined, '', 'https://legacy.example/', 'not a URL'])('has no telemetry config with legacy endpoint %s', async (value) => {
    if (value !== undefined) process.env.TELEMETRY_ENDPOINT = value;
    expect(await loadConfig()).not.toHaveProperty('telemetry');
  });
});

describe('config.federation.backoffDivisor', () => {
  const savedDivisor = process.env.FEDERATION_BACKOFF_DIVISOR;

  beforeEach(() => {
    delete process.env.FEDERATION_BACKOFF_DIVISOR;
  });

  afterEach(() => {
    if (savedDivisor === undefined) delete process.env.FEDERATION_BACKOFF_DIVISOR;
    else process.env.FEDERATION_BACKOFF_DIVISOR = savedDivisor;
  });

  it('is 1, the production schedule, when FEDERATION_BACKOFF_DIVISOR is unset', async () => {
    const config = await loadConfig();
    expect(config.federation.backoffDivisor).toBe(1);
  });

  it('takes a whole number of at least 1', async () => {
    process.env.FEDERATION_BACKOFF_DIVISOR = '30';
    const config = await loadConfig();
    expect(config.federation.backoffDivisor).toBe(30);
  });

  it('refuses 0, which would make every retry wait infinite', async () => {
    process.env.FEDERATION_BACKOFF_DIVISOR = '0';
    await expect(loadConfig()).rejects.toThrow(/FEDERATION_BACKOFF_DIVISOR/);
  });

  it('refuses a fraction, which would lengthen the waits', async () => {
    process.env.FEDERATION_BACKOFF_DIVISOR = '0.5';
    await expect(loadConfig()).rejects.toThrow(/FEDERATION_BACKOFF_DIVISOR/);
  });
});
