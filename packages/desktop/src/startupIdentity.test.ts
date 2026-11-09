import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initializeUserData } from './userDataMigration';

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function fixture(): string {
  const temp = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : os.tmpdir();
  fs.mkdirSync(temp, { recursive: true });
  const directory = fs.mkdtempSync(path.join(temp, 'veyvox-startup-'));
  directories.push(directory);
  return directory;
}

describe('installed profile startup identity', () => {
  it('sets the legacy crypto/profile name before resolving any profile path', () => {
    const root = fixture();
    const calls: string[] = [];
    const result = initializeUserData({
      setName: (name) => { calls.push(`name:${name}`); },
      getPath: (name) => { calls.push(`path:${name}`); return root; },
    });
    expect(calls).toEqual(['name:Backspace Fork', 'path:appData']);
    expect(result).toEqual({ kind: 'no-op', reason: 'old-missing' });
    expect(fs.existsSync(path.join(root, 'Veyvox'))).toBe(false);
  });

  it('moves only the historical fork profile, never the official app profile', () => {
    const root = fixture();
    const historical = path.join(root, '@backspace', 'desktop');
    fs.mkdirSync(historical, { recursive: true });
    fs.writeFileSync(path.join(historical, 'Cookies'), 'synthetic-session');
    fs.mkdirSync(path.join(root, 'Backspace'));
    fs.writeFileSync(path.join(root, 'Backspace', 'Cookies'), 'official');
    expect(initializeUserData({ setName: vi.fn(), getPath: () => root }).kind).toBe('migrated');
    expect(fs.readFileSync(path.join(root, 'Backspace Fork', 'Cookies'), 'utf8')).toBe('synthetic-session');
    expect(fs.readFileSync(path.join(root, 'Backspace', 'Cookies'), 'utf8')).toBe('official');
  });

  it('returns a fatal refusal for an unreadable existing destination', () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'Backspace Fork'), 'not-a-directory');
    expect(initializeUserData({ setName: vi.fn(), getPath: () => root }).kind).toBe('failed');
    const main = fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');
    expect(main).toMatch(/initializeUserData\(app\)/);
    expect(main).toMatch(/app\.exit\(1\)/);
    expect(main.indexOf('initializeUserData(app)')).toBeLessThan(main.indexOf('new KeybindManager'));
  });
});
