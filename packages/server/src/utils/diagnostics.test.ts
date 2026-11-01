import { describe, expect, it } from 'vitest';
import { normalizeDiagnostic, diagnosticError, diagnosticRoute } from '@backspace/shared/src/diagnostics';

describe('privacy-safe diagnostic contract', () => {
  it('keeps only bounded operational metadata, never arbitrary content', () => {
    const event = normalizeDiagnostic({ event: 'api-failed', level: 'error', subsystem: 'api', version: '1.15.9',
      status: 503, route: '/api/users/someone-private?token=secret#private', method: 'GET',
      token: 'secret', message: 'private chat', stack: 'C:/Users/private/file.ts', userId: 'private' });
    expect(event).toEqual({ event: 'api-failed', level: 'error', subsystem: 'api', version: '1.15.9',
      status: 503, route: '/api/users/:id', method: 'GET' });
    expect(JSON.stringify(event)).not.toMatch(/secret|private|someone/);
  });
  it('uses closed event/error values and strips paths, arguments and error messages', () => {
    expect(normalizeDiagnostic({ event: 'secret', level: 'error', subsystem: 'api' })).toBeNull();
    const error = Object.assign(new Error('password=secret private chat'), { code: 'secret' });
    error.stack = 'Error: password=secret private chat\n at send (C:\\Users\\person\\app\\client.ts:12:8)\n at https://chat.example/assets/index-abc.js:50:3';
    expect(diagnosticError(error)).toEqual({ errorName: 'Error', frames: ['client.ts:12:8', 'index-abc.js:50:3'] });
    expect(diagnosticRoute('https://private.example?token=secret')).toBeUndefined();
  });
  it('never extracts message text disguised as code locations, including multiline messages', () => {
    const message = 'private input /CREDENTIAL_CANARY.js:12:34\n    at fake (/MESSAGE_CANARY.ts:56:78)';
    const error = new Error(message);
    const metadata = diagnosticError(error);
    expect(JSON.stringify(metadata)).not.toMatch(/CREDENTIAL_CANARY|MESSAGE_CANARY/);
    expect(metadata.frames?.some(frame => frame.startsWith('diagnostics.test.ts:'))).toBe(true);
    expect(diagnosticError({ stack: 'Error: /MESSAGE_CANARY.ts:1:2' })).not.toHaveProperty('frames');
  });
  it('bounds numeric values, frames, versions and duplicate counts', () => {
    const event = normalizeDiagnostic({ event: 'runtime-error', level: 'error', subsystem: 'app',
      version: 'secret', count: Infinity, status: -1, frames: Array(50).fill('index.js:1:2') });
    expect(event).not.toHaveProperty('version'); expect(event).not.toHaveProperty('status');
    expect(event).not.toHaveProperty('count'); expect(event?.frames).toHaveLength(8);
  });
  it('preserves safe bind-failure codes needed for operational recovery', () => {
    expect(diagnosticError(Object.assign(new Error('private host details'), { code: 'EADDRINUSE' }))).toMatchObject({ errorCode: 'EADDRINUSE' });
  });
});
