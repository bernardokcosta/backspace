import { describe, it, expect } from 'vitest';
import { resolveTusUrl, tusEndpoint } from './tusUrl';

describe('resolveTusUrl', () => {
  it('resolves a relative Location against the current origin when no origin is given', () => {
    // jsdom serves the test page from http://localhost:3000
    expect(resolveTusUrl('/api/files/abc', undefined)).toBe('http://localhost:3000/api/files/abc');
    expect(resolveTusUrl('/api/files/abc', '')).toBe('http://localhost:3000/api/files/abc');
  });

  it('resolves relative Location against an explicitly selected current-server base', () => {
    expect(resolveTusUrl('/api/files/abc', 'https://orbit.example')).toBe('https://orbit.example/api/files/abc');
    expect(resolveTusUrl('/api/files/abc', 'https://orbit.example/')).toBe('https://orbit.example/api/files/abc');
  });

  it('keeps the port the client actually used', () => {
    expect(resolveTusUrl('/api/files/abc', 'https://chat.example.com:1443')).toBe('https://chat.example.com:1443/api/files/abc');
  });

  it('accepts a same-origin absolute Location under the actual tus upload path', () => {
    expect(resolveTusUrl('https://chat.example.com:1443/api/files/abc', 'https://chat.example.com:1443')).toBe('https://chat.example.com:1443/api/files/abc');
  });
  it.each([
    'https://other.example/api/files/abc', '//other.example/api/files/abc', 'http://other.example/api/files/abc',
    'http://localhost:3001/api/files/abc', 'http://name:password@localhost:3000/api/files/abc',
    'javascript:alert(1)', 'data:text/plain,upload', '/api/users/@me', '/api/files/',
    '/api/files/abc/extra', '/api/files/../users', '/api/files/abc?redirect=elsewhere', '/api/files/abc#fragment',
    '/api/files/abc%2fextra', '/api/files/%2e%2e',
  ])('rejects an unsafe Location before it can be given a bearer: %s', location => {
    expect(() => resolveTusUrl(location)).toThrow();
  });
  it('rejects an absolute URL using the wrong selected-server port', () => {
    expect(() => resolveTusUrl('https://chat.example.com/api/files/abc', 'https://chat.example.com:1443')).toThrow();
  });
});

describe('tusEndpoint', () => {
  it('is absolute for the home instance', () => {
    expect(tusEndpoint(undefined)).toBe('http://localhost:3000/api/files/');
    expect(tusEndpoint('')).toBe('http://localhost:3000/api/files/');
  });

  it('supports an explicitly selected current-server origin and port', () => {
    expect(tusEndpoint('https://orbit.example')).toBe('https://orbit.example/api/files/');
    expect(tusEndpoint('https://orbit.example/')).toBe('https://orbit.example/api/files/');
    expect(tusEndpoint('https://chat.example.com:1443')).toBe('https://chat.example.com:1443/api/files/');
  });
  it.each(['file:///app', 'https://name:password@server.example', 'javascript:alert(1)', 'https://server.example/path', 'https://server.example?query', 'https://server.example#hash'])('rejects a non-origin current-server base: %s', origin => {
    expect(() => tusEndpoint(origin)).toThrow();
  });
});
