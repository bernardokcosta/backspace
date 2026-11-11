import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stageRetirementFiles, retryRetirementFiles } from './retirementFiles.js';

const fixtures: Array<{ db: Database.Database; directory: string }> = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const { db, directory } of fixtures.splice(0)) {
    db.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});
const migrationHash = 'a'.repeat(64);

function fixture(databaseInsideUploads = false) {
  const root = path.join(os.tmpdir(), 'opencode');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'veyvox-retirement-files-'));
  const uploadDir = path.join(directory, 'uploads');
  fs.mkdirSync(uploadDir);
  const dbPath = path.join(databaseInsideUploads ? uploadDir : directory, 'test.db');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE __drizzle_migrations (hash text NOT NULL, created_at numeric); CREATE TABLE native_refs (value text)');
  db.pragma('foreign_keys = ON');
  fixtures.push({ db, directory });
  const options = { dbPath, uploadDir };
  const manifest = `${dbPath}.standalone-cleanup.json`;
  const file = (name: string) => path.join(uploadDir, name);
  const stage = (filenames: string[], commit = true) => {
    db.pragma('foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      stageRetirementFiles(db, { ...options, migrationHash, filenames });
      db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, 1)').run(migrationHash);
      db.exec(commit ? 'COMMIT' : 'ROLLBACK');
    } catch (error) { if (db.inTransaction) db.exec('ROLLBACK'); throw error; }
    finally { db.pragma('foreign_keys = ON'); }
  };
  return { db, options, manifest, file, stage };
}

describe('post-commit targeted retirement files', () => {
  it('never unlinks before commit and cleans only inventoried files afterwards', () => {
    const f = fixture();
    fs.writeFileSync(f.file('removed.webp'), 'remote');
    fs.writeFileSync(f.file('unrelated.webp'), 'native');
    f.stage(['removed.webp']);
    expect(fs.readFileSync(f.file('removed.webp'), 'utf8')).toBe('remote');
    expect(retryRetirementFiles(f.db, f.options)).toEqual({ deleted: 1, pending: 0 });
    expect(fs.existsSync(f.file('removed.webp'))).toBe(false);
    expect(fs.readFileSync(f.file('unrelated.webp'), 'utf8')).toBe('native');
    expect(fs.existsSync(f.manifest)).toBe(false);
    expect(retryRetirementFiles(f.db, f.options)).toEqual({ deleted: 0, pending: 0 });
  });

  it('a crash/rollback before the journal commit cannot authorize file deletion', () => {
    const f = fixture(); fs.writeFileSync(f.file('removed.webp'), 'keep');
    f.stage(['removed.webp'], false);
    expect(fs.existsSync(f.manifest)).toBe(true);
    expect(retryRetirementFiles(f.db, f.options)).toEqual({ deleted: 0, pending: 0 });
    expect(fs.readFileSync(f.file('removed.webp'), 'utf8')).toBe('keep');
    expect(fs.existsSync(f.manifest)).toBe(false);
  });

  it.each(['removed.webp', 'https://current.test/uploads/removed.webp', 'literal removed%2Ewebp link'])('protects surviving native references: %s', reference => {
    const f = fixture(); fs.writeFileSync(f.file('removed.webp'), 'native shared bytes');
    f.stage(['removed.webp']);
    f.db.prepare('INSERT INTO native_refs (value) VALUES (?)').run(reference);
    expect(retryRetirementFiles(f.db, f.options)).toEqual({ deleted: 0, pending: 0 });
    expect(fs.readFileSync(f.file('removed.webp'), 'utf8')).toBe('native shared bytes');
    expect(fs.existsSync(f.manifest)).toBe(false);
  });

  it('preserves a separately referenced thumbnail instead of deleting it implicitly', () => {
    const f = fixture(); fs.writeFileSync(f.file('video.mp4'), 'remote video'); fs.writeFileSync(f.file('video_thumb.webp'), 'native thumbnail');
    f.stage(['video.mp4', 'video_thumb.webp']);
    f.db.prepare('INSERT INTO native_refs (value) VALUES (?)').run('video_thumb.webp');
    expect(retryRetirementFiles(f.db, f.options)).toEqual({ deleted: 1, pending: 0 });
    expect(fs.readFileSync(f.file('video_thumb.webp'), 'utf8')).toBe('native thumbnail');
  });

  it('retains failed IO work and retries exactly that manifest, including ENOENT', () => {
    const f = fixture(); fs.writeFileSync(f.file('removed.webp'), 'remote'); f.stage(['removed.webp']);
    const unlink = fs.unlinkSync;
    const spy = vi.spyOn(fs, 'unlinkSync').mockImplementation(filename => {
      if (String(filename) === f.file('removed.webp')) throw Object.assign(new Error('synthetic IO failure'), { code: 'EACCES' });
      return unlink(filename);
    });
    expect(retryRetirementFiles(f.db, f.options)).toEqual({ deleted: 0, pending: 1 });
    expect(fs.existsSync(f.manifest)).toBe(true);
    spy.mockRestore();
    fs.unlinkSync(f.file('removed.webp'));
    expect(retryRetirementFiles(f.db, f.options)).toEqual({ deleted: 0, pending: 0 });
    expect(fs.existsSync(f.manifest)).toBe(false);
  });

  it('a replaced file identity stays pending and its new native bytes survive', () => {
    const f = fixture(); fs.writeFileSync(f.file('removed.webp'), 'remote'); f.stage(['removed.webp']);
    fs.writeFileSync(f.file('removed.webp'), 'new native bytes with a different size');
    expect(retryRetirementFiles(f.db, f.options)).toEqual({ deleted: 0, pending: 1 });
    expect(fs.readFileSync(f.file('removed.webp'), 'utf8')).toContain('new native');
    expect(fs.existsSync(f.manifest)).toBe(true);
  });

  it.each(['../outside.webp', '..\\outside.webp', '/outside.webp', 'C:\\outside.webp', 'https://elsewhere.test/outside.webp', 'stickers/../../outside.webp', 'NUL.webp'])('rejects unsafe paths without unlinking anything: %s', name => {
    const f = fixture(); const unlink = vi.spyOn(fs, 'unlinkSync');
    expect(() => f.stage([name])).toThrow(/path|filename/i);
    expect(unlink).not.toHaveBeenCalled();
  });

  it('handles only explicitly inventoried sticker/game-icon subdirectories', () => {
    const f = fixture(); const id = 'b'.repeat(64);
    fs.mkdirSync(f.file('stickers')); fs.mkdirSync(f.file('game-icons'));
    fs.writeFileSync(f.file(`stickers/${id}.webp`), 'remote sticker');
    fs.writeFileSync(f.file(`stickers/${id}_preview.webp`), 'remote preview');
    fs.writeFileSync(f.file(`game-icons/${id}.webp`), 'remote game icon');
    f.stage([`stickers/${id}.webp`, `stickers/${id}_preview.webp`, `game-icons/${id}.webp`]);
    expect(retryRetirementFiles(f.db, f.options)).toEqual({ deleted: 3, pending: 0 });
  });

  it('refuses symlinked file identity rather than following it', () => {
    const f = fixture(); fs.writeFileSync(f.file('removed.webp'), 'remote');
    const lstat = fs.lstatSync;
    const spy = vi.spyOn(fs, 'lstatSync').mockImplementation(((filename: fs.PathLike, options?: fs.StatOptions) => {
      const result = lstat(filename, options as { bigint: true });
      if (String(filename) === f.file('removed.webp')) return new Proxy(result, { get: (target, key, receiver) => key === 'isSymbolicLink' ? () => true : Reflect.get(target, key, receiver) });
      return result;
    }) as typeof fs.lstatSync);
    expect(() => f.stage(['removed.webp'])).toThrow(/symlink|identity/i);
    spy.mockRestore();
    expect(fs.readFileSync(f.file('removed.webp'), 'utf8')).toBe('remote');
  });

  it('does not overwrite a pending manifest and refuses a corrupt manifest', () => {
    const f = fixture(); fs.writeFileSync(f.file('removed.webp'), 'remote'); f.stage(['removed.webp']);
    const before = fs.readFileSync(f.manifest);
    expect(() => f.stage(['removed.webp'])).toThrow(/pending|manifest/i);
    expect(fs.readFileSync(f.manifest)).toEqual(before);
    fs.writeFileSync(f.manifest, '{broken');
    expect(() => retryRetirementFiles(f.db, f.options)).toThrow(/manifest/i);
    expect(fs.readFileSync(f.file('removed.webp'), 'utf8')).toBe('remote');
  });

  it('recovers an atomically staged manifest and never runs inside the upgrade transaction', () => {
    const f = fixture(); fs.writeFileSync(f.file('removed.webp'), 'remote'); f.stage(['removed.webp']);
    fs.renameSync(f.manifest, `${f.manifest}.tmp`);
    f.db.exec('BEGIN IMMEDIATE');
    expect(() => retryRetirementFiles(f.db, f.options)).toThrow(/transaction/i);
    f.db.exec('ROLLBACK');
    expect(retryRetirementFiles(f.db, f.options)).toEqual({ deleted: 1, pending: 0 });
    expect(fs.existsSync(`${f.manifest}.tmp`)).toBe(false);
  });

  it('refuses an actual directory junction/symlink beneath the upload root', () => {
    const f = fixture(); const id = 'c'.repeat(64);
    const outside = path.join(path.dirname(f.options.uploadDir), 'owned-outside-fixture');
    fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, `${id}.webp`), 'must not delete');
    fs.symlinkSync(outside, f.file('stickers'), 'junction');
    expect(() => f.stage([`stickers/${id}.webp`])).toThrow(/symlink|identity/i);
    expect(fs.readFileSync(path.join(outside, `${id}.webp`), 'utf8')).toBe('must not delete');
  });

  it('recovers a failed atomic progress publication without guessing that later files were processed', () => {
    const f = fixture(); fs.writeFileSync(f.file('removed.webp'), 'remote'); f.stage(['removed.webp']);
    const rename = fs.renameSync;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to) === f.manifest) throw Object.assign(new Error('synthetic manifest failure'), { code: 'EACCES' });
      return rename(from, to);
    });
    expect(retryRetirementFiles(f.db, f.options)).toEqual({ deleted: 1, pending: 1 });
    expect(fs.existsSync(f.manifest)).toBe(true);
    spy.mockRestore();
    expect(retryRetirementFiles(f.db, f.options)).toEqual({ deleted: 0, pending: 0 });
    expect(fs.existsSync(f.manifest)).toBe(false);
  });

  it('cannot mistake another connection\'s uncommitted witness for abandoned work', () => {
    const f = fixture(); fs.writeFileSync(f.file('removed.webp'), 'keep until commit');
    f.db.pragma('foreign_keys = OFF'); f.db.exec('BEGIN IMMEDIATE');
    stageRetirementFiles(f.db, { ...f.options, migrationHash, filenames: ['removed.webp'] });
    f.db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, 1)').run(migrationHash);
    const second = new Database(f.options.dbPath, { timeout: 0 });
    second.pragma('foreign_keys = ON');
    try {
      expect(() => retryRetirementFiles(second, f.options)).toThrow(/locked|busy/i);
      expect(fs.existsSync(f.manifest)).toBe(true);
      expect(fs.readFileSync(f.file('removed.webp'), 'utf8')).toBe('keep until commit');
    } finally { second.close(); f.db.exec('ROLLBACK'); f.db.pragma('foreign_keys = ON'); }
    expect(retryRetirementFiles(f.db, f.options)).toEqual({ deleted: 0, pending: 0 });
    expect(fs.readFileSync(f.file('removed.webp'), 'utf8')).toBe('keep until commit');
  });

  it('refuses a database nested inside uploads instead of attributing the database itself as an avatar', () => {
    const f = fixture(true);
    f.db.pragma('journal_mode = WAL');
    const unlink = vi.spyOn(fs, 'unlinkSync');
    expect(() => f.stage(['test.db'])).toThrow(/database|root/i);
    expect(unlink).not.toHaveBeenCalled();
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM native_refs').get()).toEqual({ count: 0 });
    expect(fs.existsSync(f.options.dbPath)).toBe(true);
  });
});
