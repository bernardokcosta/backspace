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

describe('retired federation configuration is never read', () => {
  const savedDivisor = process.env.FEDERATION_BACKOFF_DIVISOR;

  beforeEach(() => {
    delete process.env.FEDERATION_BACKOFF_DIVISOR;
  });

  afterEach(() => {
    if (savedDivisor === undefined) delete process.env.FEDERATION_BACKOFF_DIVISOR;
    else process.env.FEDERATION_BACKOFF_DIVISOR = savedDivisor;
  });

  it.each([undefined, '0', '0.5', '30', 'malformed'])('legacy divisor %s cannot prevent native startup or expose a federation config', async value => {
    if (value !== undefined) process.env.FEDERATION_BACKOFF_DIVISOR = value;
    expect(await loadConfig()).not.toHaveProperty('federation');
  });
});
