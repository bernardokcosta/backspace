import fs from 'fs';
import path from 'path';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';
import { thumbFilename } from './thumbnail.js';

/** An upload can move to a profile only before any message has claimed it. */
export function isOwnLooseUpload(filename: string, userId: string): boolean {
  return getDb().select({ id: schema.attachments.id }).from(schema.attachments).where(and(
    eq(schema.attachments.filename, filename), eq(schema.attachments.uploaderId, userId),
    isNull(schema.attachments.messageId), isNull(schema.attachments.dmMessageId),
  )).get() !== undefined;
}

/**
 * Delete a single uploaded file by its stored filename.
 * Uses path.basename() to prevent directory traversal attacks.
 * Tolerates ENOENT (file already gone) but logs other errors.
 * Also attempts to delete the corresponding thumbnail if one exists.
 */
export function isSafeUploadFilename(filename: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/.test(filename) &&
    !filename.endsWith('.') && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(filename);
}

/** Accepted image references never grant authority to a local upload. */
export function isValidAssetUrl(url: unknown): boolean {
  if (url === null || url === undefined) return true;
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    try { const parsed = new URL(trimmed); return !parsed.username && !parsed.password; } catch { return false; }
  }
  return isSafeUploadFilename(trimmed.startsWith('/api/uploads/') ? trimmed.slice('/api/uploads/'.length) : trimmed);
}

export function normalizeAssetUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  return trimmed ? trimmed.startsWith('/api/uploads/') ? trimmed.slice('/api/uploads/'.length) : trimmed : null;
}

/** Shared with the storage janitor: existing native profile file references. */
export function getProfileReferencedFilenames(): Set<string> {
  const db = getDb();
  const rows = [
    ...db.select({ file: schema.users.avatar }).from(schema.users).where(isNotNull(schema.users.avatar)).all(),
    ...db.select({ file: schema.users.banner }).from(schema.users).where(isNotNull(schema.users.banner)).all(),
    ...db.select({ file: schema.spaces.icon }).from(schema.spaces).where(isNotNull(schema.spaces.icon)).all(),
    ...db.select({ file: schema.spaces.banner }).from(schema.spaces).where(isNotNull(schema.spaces.banner)).all(),
    ...db.select({ file: schema.dmChannels.icon }).from(schema.dmChannels)
      .where(and(isNotNull(schema.dmChannels.icon), isNull(schema.dmChannels.deletedAt))).all()
      .filter(row => !row.file?.startsWith('http')),
  ];
  // Conservative basename retention also protects historical prefixed references.
  return new Set(rows.filter(row => row.file).map(row => path.basename(row.file!)));
}

/** Native profiles, soundboard content, attachments and their thumbnails. */
export function getReferencedFilenames(): Set<string> {
  const db = getDb(), referenced = getProfileReferencedFilenames();
  for (const row of db.select({ filename: schema.soundboardSounds.filename }).from(schema.soundboardSounds).all()) referenced.add(path.basename(row.filename));
  for (const row of db.select({ filename: schema.attachments.filename, thumbnail: schema.attachments.thumbnailFilename }).from(schema.attachments).all()) {
    referenced.add(path.basename(row.filename));
    if (row.thumbnail) referenced.add(path.basename(row.thumbnail));
  }
  return referenced;
}

/** After a committed native mutation, delete only files with no surviving holder. */
export function deleteUnreferencedUploadFiles(filenames: Iterable<string>): void {
  const candidates = new Set(filenames);
  if (candidates.size === 0) return;
  const retained = getReferencedFilenames();
  for (const value of candidates) {
    const filename = normalizeAssetUrl(value);
    if (!filename || !isSafeUploadFilename(filename) || retained.has(filename)) continue;
    deleteUploadFile(filename, { includeThumbnail: !retained.has(thumbFilename(filename)) });
  }
}

export function deleteUploadFile(filename: string, options: {
  strict?: boolean;
  includeThumbnail?: boolean;
  /** Explicit trusted directory for migration-owned asset subdirectories. */
  directory?: string;
} = {}): void {
  if (options.strict && !isSafeUploadFilename(filename)) throw new Error('Unsafe upload filename');
  const safeName = path.basename(filename);
  const directory = options.directory ?? config.uploadDir;
  const filePath = path.join(directory, safeName);
  try {
    fs.unlinkSync(filePath);
  } catch (err: unknown) {
    const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
    if (code !== 'ENOENT') {
      if (options.strict) throw err;
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to delete upload file %s: %s', safeName, message);
    }
  }

  if (options.includeThumbnail === false) return;

  // Also attempt to delete the thumbnail variant
  const thumbName = thumbFilename(safeName);
  const thumbPath = path.join(directory, thumbName);
  try {
    fs.unlinkSync(thumbPath);
  } catch (error: unknown) {
    if (options.strict && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Thumbnail may not exist — that's fine
  }
}

/**
 * Delete multiple uploaded files from disk.
 * Accepts rows with a `filename` property (e.g. attachment query results).
 */
export function deleteAttachmentFiles(rows: { filename: string }[]): void {
  deleteUnreferencedUploadFiles(rows.map(row => row.filename));
}

/**
 * Delete the attachment DB record for a given filename, plus its thumbnail.
 * Used when profile images (avatars, banners, icons) are set or replaced —
 * the file reference moves to users/spaces tables, making the attachment
 * record unnecessary. Idempotent (no-op if record doesn't exist).
 */
export function deleteAttachmentByFilename(filename: string): void {
  const db = getDb();
  const safeName = path.basename(filename);

  // Read the record first to get the thumbnail filename before deleting
  const record = db.select({
    id: schema.attachments.id,
    thumbnailFilename: schema.attachments.thumbnailFilename,
  }).from(schema.attachments)
    .where(eq(schema.attachments.filename, safeName))
    .get();
  if (!record) return;

  // Delete the attachment record
  db.delete(schema.attachments)
    .where(eq(schema.attachments.id, record.id))
    .run();

  // An old upload thumbnail can itself be a historical native image reference.
  if (record.thumbnailFilename) deleteUnreferencedUploadFiles([record.thumbnailFilename]);
}
