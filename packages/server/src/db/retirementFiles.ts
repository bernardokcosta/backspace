import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { deleteUploadFile, isSafeUploadFilename } from '../utils/fileCleanup.js';

interface PathIdentity { dev: string; ino: string }
interface FileIdentity extends PathIdentity { size: string; mtimeNs: string }
interface Entry { relativePath: string; identity: FileIdentity }
interface Manifest {
  version: 1;
  migrationHash: string;
  database: { path: string; identity: PathIdentity };
  uploads: { path: string; identity: PathIdentity };
  entries: Entry[];
}
interface Options { dbPath: string; uploadDir: string }

function identity(stat: fs.BigIntStats): FileIdentity {
  return { dev: String(stat.dev), ino: String(stat.ino), size: String(stat.size), mtimeNs: String(stat.mtimeNs) };
}

function samePath(a: PathIdentity, b: PathIdentity): boolean { return a.dev === b.dev && a.ino === b.ino; }
function sameFile(a: FileIdentity, b: FileIdentity): boolean { return samePath(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs; }
function code(error: unknown): string | undefined { return (error as NodeJS.ErrnoException | null)?.code; }

export function validateRetirementFilePath(value: string): string {
  const parts = value.split('/');
  if (parts.length === 1 && isSafeUploadFilename(value)) return value;
  if (parts.length === 2 && ['stickers', 'game-icons'].includes(parts[0]!) &&
    (parts[0] === 'stickers' ? /^[a-f0-9]{64}(?:_preview)?\.webp$/ : /^[a-f0-9]{64}\.webp$/).test(parts[1]!)) return value;
  throw new Error('Unsafe targeted cleanup path/filename');
}

function optionalStat(filename: string): fs.BigIntStats | null {
  try { return fs.lstatSync(filename, { bigint: true }); }
  catch (error) { if (code(error) === 'ENOENT') return null; throw error; }
}

function checkedFile(root: string, relativePath: string): { filename: string; stat: fs.BigIntStats } | null {
  const relative = validateRetirementFilePath(relativePath);
  const parts = relative.split('/');
  if (parts.length === 2) {
    const parent = optionalStat(path.join(root, parts[0]!));
    if (!parent) return null;
    if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error('Unsafe cleanup parent identity/symlink');
  }
  const filename = path.join(root, ...parts);
  const stat = optionalStat(filename);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Unsafe cleanup file identity/symlink');
  return { filename, stat };
}

function context(db: Database.Database, options: Options): Pick<Manifest, 'database' | 'uploads'> {
  const databasePath = fs.realpathSync(options.dbPath);
  if (fs.realpathSync(db.name) !== databasePath) throw new Error('Cleanup database identity mismatch');
  const uploadPath = fs.realpathSync(options.uploadDir);
  const relativeDatabase = path.relative(uploadPath, databasePath);
  if (relativeDatabase === '' || (!path.isAbsolute(relativeDatabase) && relativeDatabase !== '..' && !relativeDatabase.startsWith(`..${path.sep}`))) {
    throw new Error('Unsafe cleanup root: database is inside public uploads');
  }
  const database = fs.lstatSync(databasePath, { bigint: true });
  const uploads = fs.lstatSync(uploadPath, { bigint: true });
  if (!database.isFile() || database.isSymbolicLink() || !uploads.isDirectory() || uploads.isSymbolicLink()) throw new Error('Unsafe cleanup root identity');
  return { database: { path: databasePath, identity: identity(database) }, uploads: { path: uploadPath, identity: identity(uploads) } };
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function validIdentity(value: unknown, file = false): value is FileIdentity {
  return record(value) && typeof value.dev === 'string' && /^\d+$/.test(value.dev) &&
    typeof value.ino === 'string' && /^\d+$/.test(value.ino) && (!file ||
      (typeof value.size === 'string' && /^\d+$/.test(value.size) && typeof value.mtimeNs === 'string' && /^-?\d+$/.test(value.mtimeNs)));
}

function readManifest(filename: string): Manifest {
  const stat = fs.lstatSync(filename, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Unsafe cleanup manifest identity');
  let value: unknown;
  try { value = JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { throw new Error('Invalid cleanup manifest'); }
  if (!record(value) || value.version !== 1 || typeof value.migrationHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.migrationHash) ||
    !record(value.database) || typeof value.database.path !== 'string' || !validIdentity(value.database.identity) ||
    !record(value.uploads) || typeof value.uploads.path !== 'string' || !validIdentity(value.uploads.identity) || !Array.isArray(value.entries)) {
    throw new Error('Invalid cleanup manifest');
  }
  const seen = new Set<string>();
  for (const entry of value.entries) {
    if (!record(entry) || typeof entry.relativePath !== 'string' || !validIdentity(entry.identity, true)) throw new Error('Invalid cleanup manifest entry');
    validateRetirementFilePath(entry.relativePath);
    if (seen.has(entry.relativePath)) throw new Error('Invalid duplicate cleanup manifest entry');
    seen.add(entry.relativePath);
  }
  return value as unknown as Manifest;
}

function assertContext(db: Database.Database, options: Options, manifest: Manifest): void {
  const current = context(db, options);
  if (current.database.path !== manifest.database.path || current.uploads.path !== manifest.uploads.path ||
    !samePath(current.database.identity, manifest.database.identity) || !samePath(current.uploads.identity, manifest.uploads.identity)) {
    throw new Error('Cleanup database/upload root identity changed');
  }
}

function writeManifest(filename: string, manifest: Manifest, exclusive: boolean): void {
  const temporary = `${filename}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(manifest)}\n`);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  if (exclusive) {
    // Same-directory hard-link publication is atomic and cannot clobber an
    // existing pending manifest (unlike a plain initial rename on Unix).
    fs.linkSync(temporary, filename);
    fs.unlinkSync(temporary);
  } else {
    // The cleanup holds BEGIN IMMEDIATE, so another legitimate cleanup writer
    // cannot race this atomic progress replacement.
    fs.renameSync(temporary, filename);
  }
}

/** Stage explicit attributed paths while the database transaction is still
 * open. No file is deleted here, including when that transaction later rolls back. */
export function stageRetirementFiles(db: Database.Database, options: Options & {
  migrationHash: string;
  filenames: readonly string[];
}): void {
  if (!db.inTransaction || db.pragma('foreign_keys', { simple: true }) !== 0) throw new Error('Cleanup staging requires the migration transaction');
  if (!/^[a-f0-9]{64}$/.test(options.migrationHash)) throw new Error('Invalid cleanup migration hash');
  const names = [...new Set(options.filenames.map(validateRetirementFilePath))];
  const filename = `${options.dbPath}.standalone-cleanup.json`;
  if (optionalStat(filename) || optionalStat(`${filename}.tmp`)) throw new Error('Pending cleanup manifest already exists');
  if (names.length === 0) return;
  let roots: Pick<Manifest, 'database' | 'uploads'>;
  try { roots = context(db, options); }
  catch (error) { if (code(error) === 'ENOENT' && !optionalStat(options.uploadDir)) return; throw error; }
  const entries: Entry[] = [];
  for (const relativePath of names) {
    const file = checkedFile(roots.uploads.path, relativePath);
    if (file) entries.push({ relativePath, identity: identity(file.stat) });
  }
  if (entries.length) writeManifest(filename, { version: 1, migrationHash: options.migrationHash, ...roots, entries }, true);
}

function committed(db: Database.Database, hash: string): boolean {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get()) return false;
  return !!db.prepare('SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1').get(hash);
}

/** Pure raw-DB scan shared by old-data attribution and the post-commit retry.
 * Exclusions are only the preflight's already-proven removed rows; retries pass
 * none, so every surviving native value protects its referenced bytes. */
export function findReferencedRetirementPaths(db: Database.Database, paths: readonly string[], excludedRows?: ReadonlyMap<string, ReadonlySet<number>>): Set<string> {
  if (paths.length === 0) return new Set();
  const byToken = new Map<string, Set<string>>();
  for (const candidate of paths) {
    const relativePath = validateRetirementFilePath(candidate);
    const leaf = relativePath.split('/').at(-1)!;
    const keys = [leaf];
    if (relativePath.includes('/')) keys.push(leaf.slice(0, 64));
    for (const key of keys) {
      const paths = byToken.get(key) ?? new Set<string>();
      paths.add(relativePath); byToken.set(key, paths);
    }
  }
  const referenced = new Set<string>();
  const scan = (value: string): void => {
    let normalized = value.replace(/\\u00([a-fA-F0-9]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    for (let round = 0; round < 3; round++) {
      for (const match of normalized.matchAll(/[a-zA-Z0-9][a-zA-Z0-9._-]*/g)) {
        const token = match[0].replace(/\.+$/, '');
        for (const relative of byToken.get(token) ?? []) referenced.add(relative);
      }
      const decoded = normalized.replace(/(?:%[a-fA-F0-9]{2})+/g, encoded => {
        try { return decodeURIComponent(encoded); } catch { return encoded; }
      });
      if (decoded === normalized) break;
      normalized = decoded;
    }
  };
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'").all() as Array<{ name: string }>;
  for (const { name } of names) {
    const quoted = `"${name.replaceAll('"', '""')}"`;
    for (const row of db.prepare(`SELECT rowid AS __cleanup_row, * FROM ${quoted}`).iterate()) {
      if (excludedRows?.get(name)?.has((row as { __cleanup_row: number }).__cleanup_row)) continue;
      for (const value of Object.values(row as Record<string, unknown>)) if (typeof value === 'string') scan(value);
    }
  }
  return referenced;
}

/** Retry only a witnessed manifest, never a generic orphan sweep. The original
 * schema migration must already have committed. Nonzero pending MUST abort boot. */
export function retryRetirementFiles(db: Database.Database, options: Options): { deleted: number; pending: number } {
  if (db.inTransaction) throw new Error('Targeted cleanup cannot run inside the migration transaction');
  if (db.pragma('foreign_keys', { simple: true }) !== 1) throw new Error('Targeted cleanup requires foreign-key enforcement');
  const filename = `${options.dbPath}.standalone-cleanup.json`;
  const temporary = `${filename}.tmp`;
  if (!optionalStat(filename) && !optionalStat(temporary)) return { deleted: 0, pending: 0 };
  return db.transaction(() => {
    // Taking the write lock first also prevents an in-progress upgrade's
    // uncommitted witness from being mistaken for an abandoned manifest.
    if (!optionalStat(filename)) {
      const staged = readManifest(temporary);
      assertContext(db, options, staged);
      if (!committed(db, staged.migrationHash)) { fs.unlinkSync(temporary); return { deleted: 0, pending: 0 }; }
      fs.linkSync(temporary, filename); fs.unlinkSync(temporary);
    }
    const manifest = readManifest(filename);
    assertContext(db, options, manifest);
    if (optionalStat(temporary)) {
      const stat = fs.lstatSync(temporary, { bigint: true });
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Unsafe cleanup staging manifest');
      fs.unlinkSync(temporary); // The last atomically published manifest is authoritative.
    }
    if (!committed(db, manifest.migrationHash)) { fs.unlinkSync(filename); return { deleted: 0, pending: 0 }; }
    const protectedPaths = findReferencedRetirementPaths(db, manifest.entries.map(entry => entry.relativePath));
    let deleted = 0;
    const pending: Entry[] = [];
    for (let index = 0; index < manifest.entries.length; index++) {
      const entry = manifest.entries[index]!;
      try {
        assertContext(db, options, manifest);
        if (!protectedPaths.has(entry.relativePath)) {
          const file = checkedFile(manifest.uploads.path, entry.relativePath);
          if (file) {
            if (!sameFile(identity(file.stat), entry.identity)) { pending.push(entry); continue; }
            deleteUploadFile(path.basename(file.filename), { strict: true, includeThumbnail: false, directory: path.dirname(file.filename) });
            deleted++;
          }
        }
        const remaining = [...pending, ...manifest.entries.slice(index + 1)];
        writeManifest(filename, { ...manifest, entries: remaining }, false);
      } catch {
        pending.push(entry);
        // If progress publication itself failed, keep the authoritative old
        // manifest intact and do not guess whether any subsequent work completed.
        if (optionalStat(temporary)) return { deleted, pending: pending.length + manifest.entries.length - index - 1 };
      }
    }
    if (pending.length === 0) fs.unlinkSync(filename);
    else writeManifest(filename, { ...manifest, entries: pending }, false);
    return { deleted, pending: pending.length };
  }).immediate();
}
