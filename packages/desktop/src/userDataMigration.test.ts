import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { migrateUserData } from './userDataMigration';

let tmpRoot: string;
let oldParent: string;
let oldDir: string;
let newDir: string;

beforeEach(() => {
  const temp = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : os.tmpdir();
  fs.mkdirSync(temp, { recursive: true });
  tmpRoot = fs.mkdtempSync(path.join(temp, 'veyvox-migration-'));
  oldParent = path.join(tmpRoot, '@backspace');
  oldDir = path.join(oldParent, 'desktop');
  newDir = path.join(tmpRoot, 'Backspace Fork');
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function seedOld(): void {
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'instance-url.json'), '{"url":"https://nova.ddns.net"}');
  fs.mkdirSync(path.join(oldDir, 'IndexedDB'));
  fs.writeFileSync(path.join(oldDir, 'IndexedDB', 'leveldb.log'), 'data');
  for (const name of ['Cookies', 'Local State', 'language.json', 'auto-launch.json', 'window-state.json']) {
    fs.writeFileSync(path.join(oldDir, name), `synthetic-${name}`);
  }
}

function simulateCrossDevice(): void {
  const rename = fs.renameSync;
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(from) === oldDir) throw Object.assign(new Error('Cross-device rename'), { code: 'EXDEV' });
    return rename(from, to);
  });
}

describe('migrateUserData', () => {
  it('returns no-op when oldDir does not exist', () => {
    const result = migrateUserData({ oldDir, newDir, oldParent });
    expect(result).toEqual({ kind: 'no-op', reason: 'old-missing' });
    expect(fs.existsSync(newDir)).toBe(false);
  });

  it('returns no-op:identical when oldDir === newDir', () => {
    fs.mkdirSync(oldDir, { recursive: true });
    const result = migrateUserData({ oldDir, newDir: oldDir, oldParent });
    expect(result).toEqual({ kind: 'no-op', reason: 'identical' });
  });

  it('migrates and cleans empty parent when newDir is absent', () => {
    seedOld();
    const result = migrateUserData({ oldDir, newDir, oldParent });
    expect(result).toEqual({ kind: 'migrated', from: oldDir, to: newDir });
    expect(fs.existsSync(oldDir)).toBe(false);
    expect(fs.existsSync(oldParent)).toBe(false);
    expect(fs.readFileSync(path.join(newDir, 'instance-url.json'), 'utf-8'))
      .toBe('{"url":"https://nova.ddns.net"}');
    expect(fs.existsSync(path.join(newDir, 'IndexedDB', 'leveldb.log'))).toBe(true);
  });

  it('migrates when newDir exists but is empty', () => {
    seedOld();
    fs.mkdirSync(newDir);
    const result = migrateUserData({ oldDir, newDir, oldParent });
    expect(result.kind).toBe('migrated');
    expect(fs.readFileSync(path.join(newDir, 'instance-url.json'), 'utf-8'))
      .toBe('{"url":"https://nova.ddns.net"}');
  });

  it('returns no-op:new-populated and leaves both folders intact', () => {
    seedOld();
    fs.mkdirSync(newDir);
    fs.writeFileSync(path.join(newDir, 'preexisting.json'), '{}');
    const result = migrateUserData({ oldDir, newDir, oldParent });
    expect(result).toEqual({ kind: 'no-op', reason: 'new-populated' });
    expect(fs.existsSync(path.join(oldDir, 'instance-url.json'))).toBe(true);
    expect(fs.existsSync(path.join(newDir, 'preexisting.json'))).toBe(true);
  });

  it('preserves oldParent when it has sibling subdirectories', () => {
    seedOld();
    fs.mkdirSync(path.join(oldParent, 'other-pkg'));
    fs.writeFileSync(path.join(oldParent, 'other-pkg', 'state.json'), '{}');
    const result = migrateUserData({ oldDir, newDir, oldParent });
    expect(result.kind).toBe('migrated');
    expect(fs.existsSync(oldParent)).toBe(true);
    expect(fs.existsSync(path.join(oldParent, 'other-pkg', 'state.json'))).toBe(true);
  });

  it('keeps every seeded profile file and leaves the official upstream profile untouched', () => {
    seedOld();
    const official = path.join(tmpRoot, 'Backspace');
    fs.mkdirSync(official);
    fs.writeFileSync(path.join(official, 'Cookies'), 'unrelated-official-session');
    expect(migrateUserData({ oldDir, newDir, oldParent }).kind).toBe('migrated');
    expect(migrateUserData({ oldDir, newDir, oldParent }).kind).toBe('no-op');
    for (const name of ['Cookies', 'Local State', 'language.json', 'auto-launch.json', 'window-state.json']) {
      expect(fs.readFileSync(path.join(newDir, name), 'utf8')).toBe(`synthetic-${name}`);
    }
    expect(fs.readFileSync(path.join(official, 'Cookies'), 'utf8')).toBe('unrelated-official-session');
  });

  it('does not mistake an inaccessible source for a fresh installation', () => {
    seedOld();
    const stat = fs.statSync;
    vi.spyOn(fs, 'statSync').mockImplementation((...args) => {
      if (String(args[0]) === oldDir) throw Object.assign(new Error('Denied'), { code: 'EACCES' });
      return stat(...args);
    });
    expect(migrateUserData({ oldDir, newDir, oldParent }).kind).toBe('failed');
    expect(fs.readFileSync(path.join(oldDir, 'Cookies'), 'utf8')).toBe('synthetic-Cookies');
    expect(fs.existsSync(newDir)).toBe(false);
  });

  it('refuses a non-directory source or destination without deleting it', () => {
    fs.mkdirSync(oldParent);
    fs.writeFileSync(oldDir, 'not-a-profile');
    expect(migrateUserData({ oldDir, newDir, oldParent }).kind).toBe('failed');
    fs.unlinkSync(oldDir);
    fs.writeFileSync(newDir, 'not-a-directory');
    expect(migrateUserData({ oldDir, newDir, oldParent }).kind).toBe('failed');
    expect(fs.readFileSync(newDir, 'utf8')).toBe('not-a-directory');
  });

  it('does not ignore an unreadable current profile when the historical source is absent', () => {
    fs.mkdirSync(newDir);
    const stat = fs.statSync;
    vi.spyOn(fs, 'statSync').mockImplementation((...args) => {
      if (String(args[0]) === newDir) throw Object.assign(new Error('Denied'), { code: 'EACCES' });
      return stat(...args);
    });
    expect(migrateUserData({ oldDir, newDir, oldParent }).kind).toBe('failed');
  });

  it('refuses an unreadable source directory even when stat and rename permissions are available', () => {
    seedOld();
    const readdir = fs.readdirSync;
    vi.spyOn(fs, 'readdirSync').mockImplementation((...args) => {
      if (String(args[0]) === oldDir) throw Object.assign(new Error('Denied'), { code: 'EACCES' });
      return readdir(...args);
    });
    expect(migrateUserData({ oldDir, newDir, oldParent }).kind).toBe('failed');
    expect(fs.existsSync(oldDir)).toBe(true);
    expect(fs.existsSync(newDir)).toBe(false);
  });

  it('copies cross-device into an atomic destination and retains the original safety copy', () => {
    seedOld();
    simulateCrossDevice();
    expect(migrateUserData({ oldDir, newDir, oldParent }).kind).toBe('migrated');
    for (const name of ['Cookies', 'Local State', 'language.json', 'auto-launch.json', 'window-state.json']) {
      expect(fs.readFileSync(path.join(newDir, name), 'utf8')).toBe(`synthetic-${name}`);
      expect(fs.readFileSync(path.join(oldDir, name), 'utf8')).toBe(`synthetic-${name}`);
    }
    expect(migrateUserData({ oldDir, newDir, oldParent })).toEqual({ kind: 'no-op', reason: 'new-populated' });
    expect(fs.readdirSync(tmpRoot).some((name) => name.includes('.migrating-'))).toBe(false);
  });

  it('leaves the historical profile usable after a partial EXDEV copy', () => {
    seedOld();
    simulateCrossDevice();
    const copy = fs.copyFileSync;
    let copied = 0;
    vi.spyOn(fs, 'copyFileSync').mockImplementation((...args) => {
      if (++copied === 2) throw Object.assign(new Error('No space'), { code: 'ENOSPC' });
      return copy(...args);
    });
    expect(migrateUserData({ oldDir, newDir, oldParent }).kind).toBe('failed');
    expect(copied).toBe(2);
    expect(fs.readFileSync(path.join(oldDir, 'instance-url.json'), 'utf8')).toBe('{"url":"https://nova.ddns.net"}');
    expect(fs.readFileSync(path.join(oldDir, 'Cookies'), 'utf8')).toBe('synthetic-Cookies');
    expect(fs.existsSync(newDir)).toBe(false);
    expect(fs.readdirSync(tmpRoot).some((name) => name.includes('.migrating-'))).toBe(false);
  });

  it('does not overwrite a destination populated during the staged copy', () => {
    seedOld();
    simulateCrossDevice();
    const copy = fs.copyFileSync;
    vi.spyOn(fs, 'copyFileSync').mockImplementation((...args) => {
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir);
        fs.writeFileSync(path.join(newDir, 'Cookies'), 'concurrent-profile');
      }
      return copy(...args);
    });
    expect(migrateUserData({ oldDir, newDir, oldParent }).kind).toBe('failed');
    expect(fs.readFileSync(path.join(newDir, 'Cookies'), 'utf8')).toBe('concurrent-profile');
    expect(fs.readFileSync(path.join(oldDir, 'Cookies'), 'utf8')).toBe('synthetic-Cookies');
  });

  it('cleans only its staging directory when promotion fails', () => {
    seedOld();
    vi.spyOn(fs, 'renameSync').mockImplementation((from) => {
      throw Object.assign(new Error('Refused'), { code: String(from) === oldDir ? 'EXDEV' : 'EACCES' });
    });
    expect(migrateUserData({ oldDir, newDir, oldParent }).kind).toBe('failed');
    expect(fs.readFileSync(path.join(oldDir, 'Cookies'), 'utf8')).toBe('synthetic-Cookies');
    expect(fs.existsSync(newDir)).toBe(false);
    expect(fs.readdirSync(tmpRoot).some((name) => name.includes('.migrating-'))).toBe(false);
  });
});
