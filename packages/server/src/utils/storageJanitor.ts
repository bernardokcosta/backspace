import fs from 'fs';
import path from 'path';
import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { FileStore } from '@tus/file-store';
import { config } from '../config.js';
import { getDb, getRawDb, schema } from '../db/index.js';
import { deleteUnreferencedUploadFiles, deleteAttachmentFiles, getProfileReferencedFilenames, getReferencedFilenames } from './fileCleanup.js';
import { cleanupUnusedStickerAssets } from './stickerAssets.js';
import { cleanupGameIconAssets } from './gameIconAssets.js';
import type { StorageStats, StorageBreakdown, OrphanedFile, CleanupResult } from '@veyvox/shared';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv']);
const AUDIO_EXTS = new Set(['.mp3', '.ogg', '.wav', '.flac', '.aac', '.m4a', '.opus']);
const DOC_EXTS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.json', '.xml']);

/** 1-hour threshold: attachments uploaded but never linked to a message */
const UNLINKED_AGE_MS = 60 * 60 * 1000;

function classifyFile(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (DOC_EXTS.has(ext)) return 'document';
  return 'other';
}

interface DiskFile {
  filename: string;
  size: number;
  modifiedAt: number;
}

function getDiskFiles(): DiskFile[] {
  try {
    const entries = fs.readdirSync(config.uploadDir, { withFileTypes: true });
    const files: DiskFile[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      try {
        const stat = fs.statSync(path.join(config.uploadDir, entry.name));
        files.push({
          filename: entry.name,
          size: stat.size,
          modifiedAt: stat.mtimeMs,
        });
      } catch {
        // Skip files that vanished between readdir and stat
      }
    }
    return files;
  } catch (err: any) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function getUnlinkedAttachments(): { id: string; filename: string; thumbnailFilename: string | null; size: number }[] {
  const db = getDb();
  const cutoff = Date.now() - UNLINKED_AGE_MS;
  const profileReferenced = getProfileReferencedFilenames();

  // Attachments with no message_id AND no dm_message_id, older than 1 hour,
  // excluding files currently used as profile images (avatars, banners, icons)
  const rows = db.select({
    id: schema.attachments.id,
    filename: schema.attachments.filename,
    thumbnailFilename: schema.attachments.thumbnailFilename,
    size: schema.attachments.size,
    messageId: schema.attachments.messageId,
    dmMessageId: schema.attachments.dmMessageId,
    createdAt: schema.attachments.createdAt,
  }).from(schema.attachments).all();

  return rows.filter(r =>
    r.messageId === null && r.dmMessageId === null && r.createdAt < cutoff
    && !profileReferenced.has(path.basename(r.filename))
  ).map(r => ({
    id: r.id,
    filename: r.filename,
    thumbnailFilename: r.thumbnailFilename,
    size: r.size,
  }));
}

/** Attachment records whose message_id or dm_message_id references a deleted message. */
function getDanglingAttachments(): { id: string; filename: string; size: number }[] {
  const rawDb = getRawDb();

  // Space message attachments with dangling references
  const danglingSpace = rawDb.prepare(`
    SELECT a.id, a.filename, a.size
    FROM attachments a
    LEFT JOIN messages m ON a.message_id = m.id
    WHERE a.message_id IS NOT NULL AND m.id IS NULL
  `).all() as { id: string; filename: string; size: number }[];

  // DM message attachments with dangling references
  const danglingDm = rawDb.prepare(`
    SELECT a.id, a.filename, a.size
    FROM attachments a
    LEFT JOIN dm_messages dm ON a.dm_message_id = dm.id
    WHERE a.dm_message_id IS NOT NULL AND dm.id IS NULL
  `).all() as { id: string; filename: string; size: number }[];

  return [...danglingSpace, ...danglingDm];
}

/**
 * Threshold for the `staleTusSessions` count exposed via `getStorageStats()`.
 * Distinct from `tusStragglerSweepMs` (defensive sweep, default 48h) and from
 * the configurable `maxAgeHours` of the admin cleanup route — this is purely
 * the "how many entries look abandoned right now?" display threshold. An
 * active upload writes chunks often, so a 1h+ gap is a strong signal the user
 * walked away (paused/crashed/discarded without DELETE).
 */
const STALE_TUS_DISPLAY_THRESHOLD_MS = 60 * 60 * 1000;

export function getStorageStats(): StorageStats {
  const diskFiles = getDiskFiles();
  const referenced = getReferencedFilenames();
  const unlinked = getUnlinkedAttachments();
  const dangling = getDanglingAttachments();
  const staleTus = getStaleTusInfo(STALE_TUS_DISPLAY_THRESHOLD_MS);

  const danglingFilenames = new Set<string>();
  let danglingSize = 0;
  for (const att of dangling) {
    danglingFilenames.add(path.basename(att.filename));
    danglingSize += att.size;
  }

  let totalSize = 0;
  let referencedSize = 0;
  let orphanedFiles = 0;
  let orphanedSize = 0;
  let danglingFilesOnDisk = 0;
  const breakdownMap = new Map<string, { count: number; size: number }>();

  for (const file of diskFiles) {
    totalSize += file.size;
    const type = classifyFile(file.filename);
    const entry = breakdownMap.get(type) || { count: 0, size: 0 };
    entry.count++;
    entry.size += file.size;
    breakdownMap.set(type, entry);

    if (danglingFilenames.has(file.filename)) {
      // File is on disk but its attachment record points to a deleted message
      danglingFilesOnDisk++;
    } else if (referenced.has(file.filename)) {
      referencedSize += file.size;
    } else {
      orphanedFiles++;
      orphanedSize += file.size;
    }
  }

  let unlinkedSize = 0;
  for (const att of unlinked) {
    unlinkedSize += att.size;
  }

  const breakdown: StorageBreakdown[] = [];
  for (const [type, data] of breakdownMap) {
    breakdown.push({ type, count: data.count, size: data.size });
  }
  breakdown.sort((a, b) => b.size - a.size);

  return {
    totalFiles: diskFiles.length,
    totalSize,
    referencedFiles: diskFiles.length - orphanedFiles - danglingFilesOnDisk,
    referencedSize,
    orphanedFiles,
    orphanedSize,
    unlinkedAttachments: unlinked.length,
    unlinkedSize,
    danglingAttachments: dangling.length,
    danglingSize,
    staleTusSessions: staleTus.count,
    staleTusSize: staleTus.size,
    breakdown,
  };
}

export function getOrphanedFiles(): OrphanedFile[] {
  const diskFiles = getDiskFiles();
  const referenced = getReferencedFilenames();

  const orphans: OrphanedFile[] = [];
  for (const file of diskFiles) {
    if (!referenced.has(file.filename)) {
      orphans.push({
        filename: file.filename,
        size: file.size,
        modifiedAt: file.modifiedAt,
      });
    }
  }

  orphans.sort((a, b) => b.size - a.size);
  return orphans;
}

export function cleanupStorage(dryRun: boolean): CleanupResult {
  const db = getDb();
  const orphans = getOrphanedFiles();
  const unlinked = getUnlinkedAttachments();
  const profileReferenced = getProfileReferencedFilenames();
  const errors: string[] = [];
  let deletedFiles = 0;
  let freedBytes = 0;
  let deletedAttachmentRecords = 0;

  // Phase 1: Delete orphaned disk files (not referenced by any DB record)
  let removedOrphans = orphans;
  if (!dryRun) {
    try { deleteUnreferencedUploadFiles(orphans.map(file => file.filename)); }
    catch (error) {
      errors.push(`Failed to clean up orphan files: ${error instanceof Error ? error.message : String(error)}`);
      removedOrphans = [];
    }
  }
  for (const orphan of removedOrphans) {
    deletedFiles++;
    freedBytes += orphan.size;
  }

  // Phase 2: Clean up stale unlinked attachment records.
  // Files referenced by user/space profiles (avatars, banners, icons) are
  // preserved on disk — only the orphaned attachment DB record is removed.
  // Surviving attachment/profile thumbnail references protect shared bytes too.
  const unlinkedFiles: string[] = [];
  for (const att of unlinked) {
    const fileInUseByProfile = profileReferenced.has(path.basename(att.filename));
    if (!dryRun) {
      try {
        db.delete(schema.attachments)
          .where(eq(schema.attachments.id, att.id))
          .run();
        unlinkedFiles.push(att.filename, ...(att.thumbnailFilename ? [att.thumbnailFilename] : []));
      } catch (err: any) {
        errors.push(`Failed to clean up attachment ${att.id}: ${err.message}`);
        continue;
      }
    }
    deletedAttachmentRecords++;
    if (!fileInUseByProfile) {
      freedBytes += att.size;
    }
  }

  // One fresh inventory after this phase's successful row deletions, not one
  // full attachment/profile scan per candidate. No stale pre-mutation snapshot.
  if (!dryRun) {
    try { deleteUnreferencedUploadFiles(unlinkedFiles); }
    catch (error) { errors.push(`Failed to clean up unlinked files: ${error instanceof Error ? error.message : String(error)}`); }
  }

  // Phase 3: Delete dangling attachment records (message_id / dm_message_id
  // points to a message that no longer exists) and their files from disk.
  const dangling = getDanglingAttachments();
  const danglingFiles: string[] = [];
  for (const att of dangling) {
    if (!dryRun) {
      try {
        db.delete(schema.attachments)
          .where(eq(schema.attachments.id, att.id))
          .run();
        danglingFiles.push(att.filename);
      } catch (err: any) {
        errors.push(`Failed to clean up dangling attachment ${att.id}: ${err.message}`);
        continue;
      }
    }
    deletedFiles++;
    freedBytes += att.size;
    deletedAttachmentRecords++;
  }

  if (!dryRun) {
    try { deleteUnreferencedUploadFiles(danglingFiles); }
    catch (error) { errors.push(`Failed to clean up dangling files: ${error instanceof Error ? error.message : String(error)}`); }
  }

  // Phase 4: Sticker assets no collection, message or reaction on this
  // instance names any more, past their grace period (utils/stickerAssets.ts).
  const stickers = cleanupUnusedStickerAssets(dryRun);
  deletedFiles += stickers.deletedFiles;
  freedBytes += stickers.freedBytes;
  errors.push(...stickers.errors);

  // Phase 5: Game icons nobody renewed for a year, and their orphaned files
  // (utils/gameIconAssets.ts).
  const gameIcons = cleanupGameIconAssets(dryRun);
  deletedFiles += gameIcons.deletedFiles;
  freedBytes += gameIcons.freedBytes;
  errors.push(...gameIcons.errors);

  return {
    dryRun,
    deletedFiles,
    freedBytes,
    deletedAttachmentRecords,
    errors,
  };
}

export function cleanupOldMedia(maxAgeDays: number, dryRun: boolean): CleanupResult {
  const db = getDb();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const profileReferenced = getProfileReferencedFilenames();
  const errors: string[] = [];
  let deletedFiles = 0;
  let freedBytes = 0;
  let deletedAttachmentRecords = 0;

  // Find message attachments older than the cutoff
  const rawDb = getRawDb();
  const oldMedia = rawDb.prepare(`
    SELECT id, filename, size FROM attachments
    WHERE (message_id IS NOT NULL OR dm_message_id IS NOT NULL)
      AND created_at < ?
  `).all(cutoff) as { id: string; filename: string; size: number }[];

  const files: string[] = [];
  for (const att of oldMedia) {
    // Never delete files currently used as profile images
    if (profileReferenced.has(path.basename(att.filename))) continue;

    if (!dryRun) {
      try {
        db.delete(schema.attachments)
          .where(eq(schema.attachments.id, att.id))
          .run();
        files.push(att.filename);
      } catch (err: any) {
        errors.push(`Failed to delete old media ${att.id}: ${err.message}`);
        continue;
      }
    }
    deletedFiles++;
    freedBytes += att.size;
    deletedAttachmentRecords++;
  }

  if (!dryRun) {
    try { deleteUnreferencedUploadFiles(files); }
    catch (error) { errors.push(`Failed to delete old media files: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { dryRun, deletedFiles, freedBytes, deletedAttachmentRecords, errors };
}

/**
 * Hard-delete DM channels that were soft-deleted more than 24 hours ago.
 * Cascades: reactions, embeds, attachments (files + DB rows), messages,
 * members and read states, then the channel.
 * Returns the number of channels purged.
 */
export function cleanupSoftDeletedDmChannels(): number {
  const db = getDb();
  const gracePeriodMs = 24 * 60 * 60 * 1000; // 24 hours
  const cutoff = Date.now() - gracePeriodMs;

  const expired = db
    .select({ id: schema.dmChannels.id })
    .from(schema.dmChannels)
    .where(
      and(
        isNotNull(schema.dmChannels.deletedAt),
        lt(schema.dmChannels.deletedAt, cutoff),
      ),
    )
    .all();

  if (expired.length === 0) return 0;

  let purged = 0;

  for (const channel of expired) {
    try {
      // Get message IDs and attachment filenames before deletion
      const msgIds = db.select({ id: schema.dmMessages.id })
        .from(schema.dmMessages)
        .where(eq(schema.dmMessages.dmChannelId, channel.id))
        .all()
        .map(m => m.id);

      const filesToDelete: string[] = [];
      if (msgIds.length > 0) {
        const attachments = db.select({ filename: schema.attachments.filename })
          .from(schema.attachments)
          .where(inArray(schema.attachments.dmMessageId, msgIds))
          .all();
        filesToDelete.push(...attachments.map(a => a.filename));
      }

      db.transaction((tx) => {
        if (msgIds.length > 0) {
          // Delete reactions
          tx.delete(schema.dmReactions)
            .where(inArray(schema.dmReactions.dmMessageId, msgIds))
            .run();

          // Delete embeds
          tx.delete(schema.embeds)
            .where(inArray(schema.embeds.dmMessageId, msgIds))
            .run();

          // Delete attachments (DB rows)
          tx.delete(schema.attachments)
            .where(inArray(schema.attachments.dmMessageId, msgIds))
            .run();

        }

        // Delete messages
        tx.delete(schema.dmMessages)
          .where(eq(schema.dmMessages.dmChannelId, channel.id))
          .run();

        // Delete members (should be 0, defensive)
        tx.delete(schema.dmMembers)
          .where(eq(schema.dmMembers.dmChannelId, channel.id))
          .run();

        // Delete read states
        tx.delete(schema.readStates)
          .where(eq(schema.readStates.channelId, channel.id))
          .run();

        // Delete the channel itself
        tx.delete(schema.dmChannels)
          .where(eq(schema.dmChannels.id, channel.id))
          .run();
      });

      // Clean up files from disk (outside transaction — filesystem ops are idempotent)
      deleteAttachmentFiles(filesToDelete.map(f => ({ filename: f })));

      purged++;
    } catch (err) {
      console.error('[storage-janitor] Failed to purge soft-deleted DM channel %s:', channel.id, err);
    }
  }

  if (purged > 0) {
    console.log(`[storage-janitor] Purged ${purged} soft-deleted DM channels`);
  }

  return purged;
}

// ── Tus-specific janitor functions ──────────────────────────────────────────
// Lazily construct (and cache) a FileStore pointed at config.tusUploadDir so
// we don't re-instantiate it on every janitor tick. The store is only used
// for its deleteExpired() method — we never serve uploads through it.
let cachedTusStore: FileStore | null = null;
function getTusStore(): FileStore {
  if (!cachedTusStore) {
    cachedTusStore = new FileStore({
      directory: config.tusUploadDir,
      expirationPeriodInMilliseconds: config.tusExpirationMs,
    });
  }
  return cachedTusStore;
}

/**
 * Tus's own expiration sweep — removes uploads whose creation_date sidecar
 * is past the configured expirationPeriodInMilliseconds. Cheap when nothing
 * has expired (one directory listing). Returns the number of removed entries.
 */
export async function cleanupTusUploads(): Promise<{ removed: number }> {
  const store = getTusStore();
  const removed = await store.deleteExpired();
  return { removed: typeof removed === 'number' ? removed : 0 };
}

/**
 * Walk `config.tusUploadDir`, yielding `{ name, full, size, mtimeMs }` for each
 * regular file matching `predicate`. Tolerates missing dir (yields nothing) and
 * skips entries whose `statSync` throws (e.g. file vanished mid-walk).
 *
 * Shared between the unconditional straggler sweep, the admin-driven
 * stale-session cleanup, and the stats helper. Centralising the iteration
 * keeps the .tus/ semantics (which entries count as "files we care about") in
 * exactly one place.
 */
interface TusEntry {
  name: string;
  full: string;
  size: number;
  mtimeMs: number;
}

function walkTusDir(predicate: (entry: TusEntry) => boolean): TusEntry[] {
  if (!fs.existsSync(config.tusUploadDir)) return [];
  let names: string[];
  try {
    names = fs.readdirSync(config.tusUploadDir);
  } catch {
    return [];
  }
  const out: TusEntry[] = [];
  for (const name of names) {
    const full = path.join(config.tusUploadDir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const entry: TusEntry = { name, full, size: stat.size, mtimeMs: stat.mtimeMs };
    if (predicate(entry)) out.push(entry);
  }
  return out;
}

/**
 * Inspect `.tus/` for entries whose mtime is older than `thresholdMs`. Returns
 * an aggregate snapshot — count, total bytes, oldest mtime — without touching
 * any files. Used by `getStorageStats()` to surface a count of "abandoned"
 * tus sessions in the admin UI, and by the admin route as a dry-run primitive.
 *
 * "Stale" here is purely mtime-based and counts both payloads and `.json`
 * sidecars; the conservative threshold (1h) used by `getStorageStats` matches
 * the intuition that an active upload writes chunks frequently, so a 1h+ gap
 * means the user genuinely walked away.
 */
export function getStaleTusInfo(thresholdMs: number): { count: number; size: number; oldestAt: number | null } {
  const cutoff = Date.now() - thresholdMs;
  let count = 0;
  let size = 0;
  let oldestAt: number | null = null;
  walkTusDir((entry) => {
    if (entry.mtimeMs >= cutoff) return false;
    count += 1;
    size += entry.size;
    if (oldestAt === null || entry.mtimeMs < oldestAt) oldestAt = entry.mtimeMs;
    return false; // we don't need the returned array, just side-effects
  });
  return { count, size, oldestAt };
}

/**
 * Admin-driven sweep of stale tus sessions. Walks `.tus/`, finds entries with
 * mtime older than `thresholdMs`, optionally unlinks each one, and returns an
 * aggregate result. In `dryRun=true` mode no files are touched. Per-file
 * unlink errors are collected (not thrown) so a single bad entry can't abort
 * the whole sweep.
 *
 * Note that `.tus/` holds *pairs* (payload + `.json` sidecar) per session, but
 * we treat each file independently — the sidecar's mtime is updated by
 * `@tus/file-store` on every PATCH, so payload + sidecar move together; if the
 * pair is genuinely abandoned, both are stale and both get reaped. No need for
 * pair reconciliation.
 */
export function cleanupStaleTusSessions(
  thresholdMs: number,
  dryRun: boolean,
): { deletedFiles: number; freedBytes: number; errors: string[] } {
  const cutoff = Date.now() - thresholdMs;
  const stale = walkTusDir((entry) => entry.mtimeMs < cutoff);
  const errors: string[] = [];
  let deletedFiles = 0;
  let freedBytes = 0;
  for (const entry of stale) {
    if (!dryRun) {
      try {
        fs.unlinkSync(entry.full);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to delete ${entry.name}: ${message}`);
        continue;
      }
    }
    deletedFiles += 1;
    freedBytes += entry.size;
  }
  return { deletedFiles, freedBytes, errors };
}

/**
 * Defensive sweep of `${config.tusUploadDir}`: any file (payload OR sidecar)
 * whose mtime is older than `thresholdMs` (default `config.tusStragglerSweepMs`,
 * 48 h) is unlinked. Covers the rare case where a tus crash left an orphan
 * that deleteExpired() doesn't recognize — e.g. a payload without sidecar (so
 * creation_date is unknown), or a sidecar without payload (so getUpload()
 * rejects).
 *
 * Janitor-tick contract preserved: returns `{ removed }` with the count of
 * files actually unlinked. Internally delegates to `cleanupStaleTusSessions`.
 */
export function cleanupTusStragglers(thresholdMs: number = config.tusStragglerSweepMs): { removed: number } {
  const result = cleanupStaleTusSessions(thresholdMs, false);
  return { removed: result.deletedFiles };
}

// cleanupStorage is expensive (full disk scan + DB joins) so we run it at
// most once per 24h rather than on every janitor tick.
const STORAGE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
let lastStorageCleanupAt = 0;

/**
 * Run the existing local periodic cleanup tasks:
 *  - Soft-deleted DM channels past grace period
 *  - Expired tus uploads and stale tus sidecars
 *  - Once-per-day: cleanupStorage (orphan files + unlinked + dangling + unused stickers)
 */
export async function runStorageJanitor(): Promise<void> {
  try {
    cleanupSoftDeletedDmChannels();

    // Tus expiration sweep — every tick. Removes tus uploads whose
    // creation_date sidecar is past config.tusExpirationMs (24h default).
    // Cheap when nothing has expired (one directory listing).
    try {
      await cleanupTusUploads();
    } catch (err) {
      console.warn('[storage-janitor] cleanupTusUploads failed:', err);
    }

    // Tus straggler sweep — every tick. Defensive removal of payload/sidecar
    // files in .tus/ whose mtime is older than config.tusStragglerSweepMs
    // (48h default). Catches orphans that deleteExpired() can't recognize
    // (payload without sidecar, sidecar without payload).
    try {
      cleanupTusStragglers();
    } catch (err) {
      console.warn('[storage-janitor] cleanupTusStragglers failed:', err);
    }

    // Once-per-day storage cleanup. Sweeps orphan disk files (unreferenced
    // by any DB row) + unlinked attachments (uploaded but never attached
    // to a message past the 1h grace) + dangling attachment rows. Backs up
    // the tus POST_FINISH atomicity guarantees in routes/files.ts.
    const now = Date.now();
    if (now - lastStorageCleanupAt >= STORAGE_CLEANUP_INTERVAL_MS) {
      lastStorageCleanupAt = now;
      try {
        const result = cleanupStorage(false);
        if (result.deletedFiles > 0 || result.deletedAttachmentRecords > 0 || result.errors.length > 0) {
          console.log(
            `[storage-janitor] Daily storage sweep: deletedFiles=${result.deletedFiles} freedBytes=${result.freedBytes} deletedAttachmentRecords=${result.deletedAttachmentRecords} errors=${result.errors.length}`,
          );
        }
      } catch (err) {
        console.error('[storage-janitor] Storage cleanup error:', err);
      }
    }
  } catch (err) {
    console.error('[storage-janitor] Native GC sweep error:', err);
  }
}
