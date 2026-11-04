import { describe, expect, it } from 'vitest';
import { normalizeDiagnostic, diagnosticError, diagnosticRoute, diagnosticLocation } from '@backspace/shared/src/diagnostics';

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
  it('preserves a closed WS error event and rejects unrecognized codes', () => {
    expect(normalizeDiagnostic({ event: 'ws-error', subsystem: 'websocket', level: 'error', errorCode: 'missing_permission' }))
      .toMatchObject({ event: 'ws-error', errorCode: 'missing_permission' });
    expect(normalizeDiagnostic({ event: 'ws-error', subsystem: 'websocket', level: 'error', errorCode: 'PRIVATE_CANARY' }))
      .not.toHaveProperty('errorCode');
  });
  it('retains only bounded script basenames for runtime errors without a stack', () => {
    expect(diagnosticLocation('https://private.example/assets/client-a.js?secret#private', 12, 34)).toEqual({ frames: ['client-a.js:12:34'] });
    expect(diagnosticLocation('file:///C:/Users/private/app/index.js', 1, 0)).toEqual({ frames: ['index.js:1:0'] });
    for (const filename of ['data:text/javascript,private', 'https://private.example/avatar.png', 'private input']) {
      expect(diagnosticLocation(filename, 1, 1)).toEqual({});
    }
    expect(diagnosticLocation('/assets/index.js', Infinity, 1)).toEqual({});
    expect(diagnosticLocation('/assets/index.js', 0, 1)).toEqual({});
    expect(diagnosticLocation('/assets/index.js', 1, 100_000_000)).toEqual({});
  });
  it('never mistakes a URL authority for a script basename', () => {
    for (const filename of ['https://customer-private.js?token=secret', 'https://customer-private.js', '//customer-private.js']) {
      const location = diagnosticLocation(filename, 12, 34);
      expect(location).toEqual({});
      const safe = normalizeDiagnostic({ event: 'runtime-error', subsystem: 'app', level: 'error', ...location });
      expect(JSON.stringify(safe)).not.toMatch(/customer-private|secret/);
    }
  });
});
