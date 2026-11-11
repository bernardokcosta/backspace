import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { Upload, type UploadOptions } from 'tus-js-client';
import { resolveTusUrl, tusEndpoint } from '../utils/tusUrl';
import type { Attachment } from '@veyvox/shared';
import { useAuthStore } from './authStore';
import { getHandle, putHandle, ensurePermission, queryHandlePermission } from '../utils/idbHandles';
import i18n from '../i18n';
import { isPermanentUploadError, shouldRetryTusUpload } from '../utils/tusRetry';

export type TransferType = 'upload' | 'download';
export type TransferState =
  | 'queued' | 'active' | 'paused' | 'completed' | 'failed' | 'aborted';

export interface TransferError {
  message: string;
  permanent: boolean;
}

export interface Transfer {
  id: string;
  type: TransferType;
  state: TransferState;
  file: { name: string; size: number; mimetype: string };
  progress: { loaded: number; total: number };
  error?: TransferError;
  channelId?: string;
  tray: boolean;
  /** Captured current-server origin, never an alternate routing destination. */
  origin?: string;

  // Upload-specific
  tusUploadUrl?: string;
  tusExpiresAt?: number;
  fileHandleId?: string;
  attachmentId?: string;
  attachmentFilename?: string;
  uploaderUserId?: string;

  // Download-specific
  sourceUrl?: string;
  destFileHandleId?: string;
  bytesWrittenToDisk?: number;
}

export interface CreateTransferInput {
  type: TransferType;
  file: { name: string; size: number; mimetype: string };
  tray: boolean;
  channelId?: string;
  fileHandleId?: string;
  destFileHandleId?: string;
  sourceUrl?: string;
  uploaderUserId?: string;
}

interface TransferStoreState {
  transfers: Map<string, Transfer>;
  /**
   * Mirrors the keys of the module-scoped `liveUploadFiles` map so React components
   * can subscribe to "do we still hold the original File for this transfer?" reactively.
   * Session-scoped — never persisted (the underlying File refs vanish on reload).
   */
  hasInMemoryFile: Set<string>;
}

interface TransferStoreActions {
  createTransfer: (input: CreateTransferInput) => string;
  setState_: (id: string, state: TransferState) => void;
  updateProgress: (id: string, loaded: number) => void;
  setError: (id: string, error: TransferError) => void;
  setTusUrl: (id: string, url: string, expiresAt: number) => void;
  setAttachmentRef: (id: string, attachmentId: string, filename: string) => void;
  remove: (id: string) => void;

  startUpload: (file: Blob, opts: { channelId?: string; tray?: boolean; fileHandleId?: string }) => Promise<string>;
  abortUpload: (id: string) => void;
  pauseUpload: (id: string) => void;
  resumeUpload: (id: string) => Promise<void>;

  startDownload: (url: string, opts: { filename: string; size?: number; mimetype?: string; tray?: boolean }) => Promise<string>;
  abortDownload: (id: string) => void;
  pauseDownload: (id: string) => void;
  resumeDownload: (id: string) => Promise<void>;
  pauseSession: () => void;
  /** Finish one pending boot restoration only after native identity is known. */
  restoreSession: () => Promise<void>;

  get: (id: string) => Transfer | undefined;
  listVisible: () => Transfer[];
  listForChannel: (channelId: string) => Transfer[];
}

type TransferStore = TransferStoreState & TransferStoreActions;

/** Persisted local work belongs to its captured current server and native account. */
export function isCurrentTransfer(transfer: Transfer): boolean {
  const userId = useAuthStore.getState().user?.id;
  return !!userId && (!transfer.origin || transfer.origin === window.location.origin)
    && transfer.uploaderUserId === userId;
}

function uuid(): string {
  return crypto.randomUUID();
}

// Live tus Upload instances — keyed by transferId. Not serializable, never persisted.
const liveUploads = new Map<string, Upload>();
// Covers asynchronous handle acquisition too, before a tus object exists.
const uploadAttempts = new Map<string, object>();

// Original File/Blob references — keyed by transferId. Survive pause; cleared
// on abort or success. Used for in-session resume when no FileSystemFileHandle exists
// (file picker, paste, or drag-drop on Firefox/Safari). Cross-reload resume still
// requires a handle — that path uses idbHandles.
const liveUploadFiles = new Map<string, Blob>();

// Live download AbortControllers — keyed by transferId. Not serializable, never persisted.
const liveDownloads = new Map<string, AbortController>();
let needsSessionRestoration = false;

// Custom storage that serializes Map<string, Transfer> as an array of entries.
// Only the `transfers` slice is persisted; partialize controls which entries.
const mapAwareStorage: PersistStorage<Pick<TransferStoreState, 'transfers'>> = {
  getItem: (name) => {
    try {
      const raw = localStorage.getItem(name);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { state: { transfers: [string, Transfer][] }; version?: number };
      const stateOut: Pick<TransferStoreState, 'transfers'> = {
        transfers: new Map<string, Transfer>(parsed.state.transfers ?? []),
      };
      return { state: stateOut, version: parsed.version } as StorageValue<Pick<TransferStoreState, 'transfers'>>;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      const entries = Array.from(value.state.transfers.entries());
      const payload = JSON.stringify({ state: { transfers: entries }, version: value.version });
      localStorage.setItem(name, payload);
    } catch (err) {
      console.warn(`[transferStore] persist failed:`, err);
    }
  },
  removeItem: (name) => {
    try { localStorage.removeItem(name); } catch { /* In-memory work remains usable. */ }
  },
};

export const useTransferStore = create<TransferStore>()(
  persist(
    (set, get) => {
      // DRY helper: keep the reactive `hasInMemoryFile` set in sync with the
      // module-scoped `liveUploadFiles` map. Both call-sites that mutate the map
      // immediately follow up with this so subscribers re-render.
      const setInMemoryRef = (id: string, present: boolean) => {
        set((s) => {
          const has = s.hasInMemoryFile.has(id);
          if (present === has) return s;
          const next = new Set(s.hasInMemoryFile);
          if (present) next.add(id); else next.delete(id);
          return { hasInMemoryFile: next };
        });
      };

      return ({
      transfers: new Map<string, Transfer>(),
      hasInMemoryFile: new Set<string>(),

      createTransfer: (input) => {
        const id = uuid();
        const t: Transfer = {
          id,
          type: input.type,
          state: 'queued',
          file: input.file,
          progress: { loaded: 0, total: input.file.size },
          tray: input.tray,
          channelId: input.channelId,
          origin: window.location.origin,
          fileHandleId: input.fileHandleId,
          destFileHandleId: input.destFileHandleId,
          sourceUrl: input.sourceUrl,
          uploaderUserId: input.uploaderUserId ?? useAuthStore.getState().user?.id,
        };
        set((s) => {
          const next = new Map(s.transfers);
          next.set(id, t);
          return { transfers: next };
        });
        return id;
      },

      setState_: (id, state) => set((s) => {
        const t = s.transfers.get(id);
        if (!t) return s;
        const next = new Map(s.transfers);
        next.set(id, { ...t, state });
        return { transfers: next };
      }),

      updateProgress: (id, loaded) => set((s) => {
        const t = s.transfers.get(id);
        if (!t) return s;
        const next = new Map(s.transfers);
        next.set(id, { ...t, progress: { ...t.progress, loaded } });
        return { transfers: next };
      }),

      setError: (id, error) => set((s) => {
        const t = s.transfers.get(id);
        if (!t) return s;
        const next = new Map(s.transfers);
        next.set(id, { ...t, error, state: 'failed' });
        return { transfers: next };
      }),

      setTusUrl: (id, tusUploadUrl, tusExpiresAt) => set((s) => {
        const t = s.transfers.get(id);
        if (!t) return s;
        const next = new Map(s.transfers);
        next.set(id, { ...t, tusUploadUrl, tusExpiresAt });
        return { transfers: next };
      }),

      setAttachmentRef: (id, attachmentId, filename) => set((s) => {
        const t = s.transfers.get(id);
        if (!t) return s;
        const next = new Map(s.transfers);
        next.set(id, { ...t, attachmentId, attachmentFilename: filename });
        return { transfers: next };
      }),

      remove: (id) => {
        uploadAttempts.delete(id);
        const upload = liveUploads.get(id);
        liveUploads.delete(id);
        void upload?.abort(false).catch(() => {});
        liveDownloads.get(id)?.abort();
        liveDownloads.delete(id);
        liveUploadFiles.delete(id);
        setInMemoryRef(id, false);
        set((s) => {
          if (!s.transfers.has(id)) return s;
          const next = new Map(s.transfers);
          next.delete(id);
          return { transfers: next };
        });
      },

      startUpload: async (file, opts) => {
        const { token, user, sessionRevision } = useAuthStore.getState();
        if (!token || !user) throw new Error(i18n.t('uploads:failure.notAuthenticated'));

        const endpoint = tusEndpoint();

        const fileLike = file instanceof File
          ? { name: file.name, size: file.size, mimetype: file.type || 'application/octet-stream' }
          : { name: 'upload', size: file.size, mimetype: (file as Blob).type || 'application/octet-stream' };

        const id = get().createTransfer({
          type: 'upload',
          file: fileLike,
          tray: opts.tray ?? true,
          channelId: opts.channelId,
          fileHandleId: opts.fileHandleId,
          uploaderUserId: user?.id,
        });
        const attempt = {};
        uploadAttempts.set(id, attempt);
        const current = () => {
          const transfer = get().get(id), auth = useAuthStore.getState();
          return uploadAttempts.get(id) === attempt && !!transfer && isCurrentTransfer(transfer) && auth.sessionRevision === sessionRevision && auth.token === token;
        };

        const tusOpts: UploadOptions = {
          endpoint,
          retryDelays: [0, 1000, 3000, 5000, 10_000],
          onShouldRetry: (error, attempt, options) => current() && !get().get(id)?.error?.permanent && shouldRetryTusUpload(error, attempt, options),
          metadata: {
            filename: fileLike.name,
            filetype: fileLike.mimetype,
          },
          chunkSize: 5 * 1024 * 1024,
          onBeforeRequest: req => {
            if (!current()) throw new DOMException('Upload attempt changed', 'AbortError');
            if (req.getMethod() === 'POST') {
              if (req.getURL() !== endpoint) throw new Error(i18n.t('uploads:failure.invalidResponse'));
            } else resolveTusUrl(req.getURL());
            req.setHeader('Authorization', `Bearer ${token}`);
          },
          onProgress: (loaded: number) => {
            if (!current()) return;
            get().updateProgress(id, loaded);
            const t = get().get(id);
            if (t?.state === 'queued') get().setState_(id, 'active');
          },
          onAfterResponse: (_req, res) => {
            if (!current()) throw new DOMException('Session changed', 'AbortError');
            // res.getHeader returns string | undefined per tus-js-client v4 types.
            const location = res.getHeader('Location');
            const expires = res.getHeader('Upload-Expires');
            if (location && !get().get(id)?.tusUploadUrl) {
              const expiresMs = expires ? new Date(expires).getTime() : Date.now() + 24 * 60 * 60 * 1000;
              try { get().setTusUrl(id, resolveTusUrl(location), expiresMs); }
              catch (error) { get().setError(id, { message: i18n.t('uploads:failure.invalidResponse'), permanent: true }); throw error; }
            }
          },
          onSuccess: (payload) => {
            if (!current()) return;
            try {
              const body = payload.lastResponse?.getBody?.() ?? '';
              const att = JSON.parse(body) as Attachment;
              get().setAttachmentRef(id, att.id, att.filename);
              get().setState_(id, 'completed');
              get().updateProgress(id, fileLike.size);
            } catch (e) {
              const msg = e instanceof Error ? e.message : i18n.t('uploads:failure.invalidResponse');
              get().setError(id, { message: msg, permanent: true });
            } finally {
              uploadAttempts.delete(id);
              liveUploads.delete(id);
              liveUploadFiles.delete(id);
              setInMemoryRef(id, false);
            }
          },
          onError: (err: Error) => {
            if (!current()) return;
            const msg = err.message ?? i18n.t('uploads:failure.uploadError');
            const permanent = get().get(id)?.error?.permanent || isPermanentUploadError(err);
            get().setError(id, { message: msg, permanent });
            uploadAttempts.delete(id);
            liveUploads.delete(id);
          },
        };

        const upload = new Upload(file as File, tusOpts);
        liveUploads.set(id, upload);
        liveUploadFiles.set(id, file);
        setInMemoryRef(id, true);
        upload.start();
        return id;
      },

      abortUpload: (id) => {
        const t = get().get(id);
        if (!t) return;
        if (!isCurrentTransfer(t)) { get().pauseUpload(id); return; }
        const u = liveUploads.get(id);
        uploadAttempts.delete(id);
        liveUploads.delete(id);
        if (u) {
          void u.abort(false).catch(() => { /* server may be unreachable; that's OK */ });
        }
        if (t.tusUploadUrl && !t.attachmentId) {
          // No live instance, but server-side .tus state still exists (e.g., this
          // transfer failed mid-flight or was paused with a stored URL). Send DELETE
          // directly so the partial bytes don't sit on disk until the janitor sweeps.
          const token = useAuthStore.getState().token;
          if (token) {
            let uploadUrl: string;
            try { uploadUrl = resolveTusUrl(t.tusUploadUrl); }
            catch { get().setState_(id, 'aborted'); return; }
            void fetch(uploadUrl, {
              method: 'DELETE',
              redirect: 'error',
              headers: {
                Authorization: `Bearer ${token}`,
                'Tus-Resumable': '1.0.0',
              },
            }).catch(() => { /* server unreachable — janitor will eventually clean */ });
          }
        }
        // Keep liveUploadFiles entry — needed for retry-after-abort. Cleared by remove().
        get().setState_(id, 'aborted');
      },

      pauseUpload: (id) => {
        uploadAttempts.delete(id);
        const u = liveUploads.get(id);
        liveUploads.delete(id);
        if (u) {
          // abort(false) keeps server-side state — resumable.
          void u.abort(false).catch(() => { /* ignore */ });
        }
        get().setState_(id, 'paused');
      },

      resumeUpload: async (id) => {
        const t = get().get(id);
        if (!t || t.type !== 'upload') return;
        get().pauseUpload(id);
        if (!isCurrentTransfer(t)) { get().setState_(id, 'paused'); return; }
        const attempt = {};
        uploadAttempts.set(id, attempt);
        const { token, sessionRevision } = useAuthStore.getState();
        const current = () => {
          const transfer = get().get(id), auth = useAuthStore.getState();
          return uploadAttempts.get(id) === attempt && !!transfer && isCurrentTransfer(transfer) && auth.sessionRevision === sessionRevision && auth.token === token;
        };
        if (!token) {
          get().setError(id, { message: i18n.t('uploads:failure.notAuthenticated'), permanent: true });
          return;
        }

        // Try in-memory File (same-session resume — file picker, paste, browsers
        // without getAsFileSystemHandle, or retry after abort).
        let blob: Blob | undefined = liveUploadFiles.get(id);

        // Fall back to persisted FileSystemFileHandle (cross-reload resume on Chrome/Edge).
        if (!blob && t.fileHandleId) {
          try {
            const handle = await getHandle(t.fileHandleId);
            if (!current()) return;
            if (handle) {
              const perm = await ensurePermission(handle, 'read');
              if (!current()) return;
              if (perm === 'granted') {
                const handleAny = handle as unknown as { getFile?: () => Promise<File> };
                if (typeof handleAny.getFile === 'function') blob = await handleAny.getFile();
              }
            }
          } catch { /* Unavailable handle storage leaves the native file unavailable. */ }
        }

        if (!current()) return;
        if (!blob) {
          // No in-memory File (post-reload) AND no FS handle to reacquire bytes from.
          // The user must discard and re-upload. Setting 'failed' lets the orchestrator's
          // mark-failed sweep keep the bubble in failed state and Message.tsx surfaces
          // the discard control. The Retry button is hidden in this case (canRetry gate).
          get().setError(id, {
            message: i18n.t('uploads:failure.fileUnavailable'),
            permanent: true,
          });
          return;
        }

        // Resume the existing tus session if we have a valid, non-expired URL and
        // we weren't aborted. Otherwise start a fresh session reusing this transferId
        // (retry-after-abort, retry-after-failure, retry-after-expiry).
        let resumeUrl: string | null = null;
        if (t.tusUploadUrl && t.state !== 'aborted' && Date.now() <= (t.tusExpiresAt ?? 0)) {
          try { resumeUrl = resolveTusUrl(t.tusUploadUrl); }
          catch { get().setError(id, { message: i18n.t('uploads:failure.invalidResponse'), permanent: true }); return; }
        }
        const canResume = resumeUrl !== null;

        if (!canResume) {
          // Reset transient state so a fresh tus session starts cleanly.
          set((s) => {
            const cur = s.transfers.get(id);
            if (!cur) return s;
            const next = new Map(s.transfers);
            next.set(id, {
              ...cur,
              tusUploadUrl: undefined,
              tusExpiresAt: undefined,
              attachmentId: undefined,
              attachmentFilename: undefined,
              error: undefined,
              progress: { loaded: 0, total: blob!.size },
            });
            return { transfers: next };
          });
        }

        get().setState_(id, 'queued');
        set(s => {
          const transfer = s.transfers.get(id);
          return transfer ? { transfers: new Map(s.transfers).set(id, { ...transfer, error: undefined }) } : s;
        });

        const fileLike = blob instanceof File
          ? { name: blob.name, mimetype: blob.type || 'application/octet-stream' }
          : { name: t.file.name, mimetype: blob.type || t.file.mimetype };

        const tusOpts: UploadOptions = {
          endpoint: tusEndpoint(),
          retryDelays: [0, 1000, 3000, 5000, 10_000],
          onShouldRetry: (error, attempt, options) => current() && !get().get(id)?.error?.permanent && shouldRetryTusUpload(error, attempt, options),
          chunkSize: 5 * 1024 * 1024,
          onBeforeRequest: req => {
            if (!current()) throw new DOMException('Upload attempt changed', 'AbortError');
            if (req.getMethod() === 'POST') {
              if (req.getURL() !== tusEndpoint()) throw new Error(i18n.t('uploads:failure.invalidResponse'));
            } else resolveTusUrl(req.getURL());
            req.setHeader('Authorization', `Bearer ${token}`);
          },
          ...(resumeUrl
            ? { uploadUrl: resumeUrl }
            : { metadata: { filename: fileLike.name, filetype: fileLike.mimetype } }),
          onProgress: (loaded: number) => {
            if (!current()) return;
            get().updateProgress(id, loaded);
            const cur = get().get(id);
            if (cur?.state !== 'active') get().setState_(id, 'active');
          },
          onAfterResponse: (_req, res) => {
            if (!current()) throw new DOMException('Session changed', 'AbortError');
            // Capture the new Location for fresh sessions; resume reuses the existing one.
            if (canResume) return;
            const location = res.getHeader('Location');
            const expires = res.getHeader('Upload-Expires');
            if (location && !get().get(id)?.tusUploadUrl) {
              const expiresMs = expires ? new Date(expires).getTime() : Date.now() + 24 * 60 * 60 * 1000;
              try { get().setTusUrl(id, resolveTusUrl(location), expiresMs); }
              catch (error) { get().setError(id, { message: i18n.t('uploads:failure.invalidResponse'), permanent: true }); throw error; }
            }
          },
          onSuccess: (payload) => {
            if (!current()) return;
            try {
              const body = payload.lastResponse?.getBody?.() ?? '';
              const att = JSON.parse(body) as Attachment;
              get().setAttachmentRef(id, att.id, att.filename);
              get().setState_(id, 'completed');
              get().updateProgress(id, blob!.size);
            } catch (e) {
              const msg = e instanceof Error ? e.message : i18n.t('uploads:failure.invalidResponse');
              get().setError(id, { message: msg, permanent: true });
            } finally {
              uploadAttempts.delete(id);
              liveUploads.delete(id);
              liveUploadFiles.delete(id);
              setInMemoryRef(id, false);
            }
          },
          onError: (err: Error) => {
            if (!current()) return;
            const msg = err.message ?? i18n.t('uploads:failure.uploadError');
            const permanent = get().get(id)?.error?.permanent || isPermanentUploadError(err);
            get().setError(id, { message: msg, permanent });
            uploadAttempts.delete(id);
            liveUploads.delete(id);
          },
        };

        // Retain the resolved blob in the in-memory map so a subsequent retry-after-failure
        // (e.g., transient network error) can resume without going through the handle path.
        liveUploadFiles.set(id, blob);
        setInMemoryRef(id, true);

        const upload = new Upload(blob as File, tusOpts);
        liveUploads.set(id, upload);
        upload.start();
      },

      startDownload: async (url, opts) => {
        const fileLike = {
          name: opts.filename,
          size: opts.size ?? 0,
          mimetype: opts.mimetype ?? 'application/octet-stream',
        };
        const id = get().createTransfer({
          type: 'download',
          file: fileLike,
          tray: opts.tray ?? true,
          sourceUrl: url,
        });

        const controller = new AbortController();
        liveDownloads.set(id, controller);
        const { sessionRevision } = useAuthStore.getState();
        const current = () => liveDownloads.get(id) === controller && !controller.signal.aborted
          && sessionRevision === useAuthStore.getState().sessionRevision
          && !!get().get(id) && isCurrentTransfer(get().get(id)!);
        const assertCurrent = () => { if (!current()) throw new DOMException('Download attempt changed', 'AbortError'); };
        get().setState_(id, 'active');

        // FS Access path: only when the API exists. We DON'T require opts.size —
        // size is unknown for some downloads and we want resume capability anyway.
        const supportsFs = typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';

        // Hoisted so the catch block can flush partial bytes on AbortError.
        // Without close(), the FS Access writable's buffer is discarded and the
        // file is left at its truncated (open-time) size — which is 0 since we
        // open with keepExistingData: false. Resuming would then re-download
        // from byte 0 instead of continuing from the offset we'd reached.
        let writable: FileSystemWritableFileStream | undefined;
        try {
          assertCurrent();
          if (supportsFs) {
            const showSavePicker = (window as unknown as {
              showSaveFilePicker: (opts: { suggestedName: string }) => Promise<FileSystemFileHandle>;
            }).showSaveFilePicker;
            let handle: FileSystemFileHandle;
            try {
              handle = await showSavePicker({ suggestedName: opts.filename });
            } catch {
              // User canceled the picker — abort cleanly.
              if (current()) get().setState_(id, 'aborted');
              return id;
            }
            assertCurrent();
            const handleId = `dl-${id}`;
            await putHandle(handleId, handle);
            assertCurrent();
            // Persist the handle key on the transfer.
            set((s) => {
              const t = s.transfers.get(id);
              if (!t) return s;
              const next = new Map(s.transfers);
              next.set(id, { ...t, destFileHandleId: handleId, bytesWrittenToDisk: 0 });
              return { transfers: next };
            });
            writable = await handle.createWritable({ keepExistingData: false });
            assertCurrent();
            const resp = await fetch(url, { signal: controller.signal });
            assertCurrent();
            if (!resp.ok || !resp.body) throw new Error(i18n.t('uploads:failure.downloadFailed', { status: resp.status }));
            const reader = resp.body.getReader();
            let written = 0;
            for (;;) {
              const { value, done } = await reader.read();
              assertCurrent();
              if (done) break;
              await writable.write(value);
              assertCurrent();
              written += value.byteLength;
              get().updateProgress(id, written);
              set((s) => {
                const t = s.transfers.get(id);
                if (!t) return s;
                const next = new Map(s.transfers);
                next.set(id, { ...t, bytesWrittenToDisk: written });
                return { transfers: next };
              });
            }
            await writable.close();
            writable = undefined;
            if (current()) get().setState_(id, 'completed');
          } else {
            // Blob fallback — accumulate in memory, then trigger anchor click.
            const resp = await fetch(url, { signal: controller.signal });
            assertCurrent();
            if (!resp.ok) throw new Error(i18n.t('uploads:failure.downloadFailed', { status: resp.status }));
            const total = Number(resp.headers.get('Content-Length') ?? opts.size ?? 0);
            const chunks: Uint8Array[] = [];
            const reader = resp.body!.getReader();
            let loaded = 0;
            for (;;) {
              const { value, done } = await reader.read();
              assertCurrent();
              if (done) break;
              chunks.push(value);
              loaded += value.byteLength;
              if (total) get().updateProgress(id, loaded);
            }
            const blob = new Blob(chunks as BlobPart[], { type: fileLike.mimetype });
            const objUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objUrl;
            a.download = opts.filename;
            a.click();
            URL.revokeObjectURL(objUrl);
            get().setState_(id, 'completed');
          }
        } catch (err) {
          // Always flush whatever we managed to write before bubbling out — on
          // AbortError so resume can pick up at the right offset, and on real
          // errors so disk state matches reality (no half-buffered ghost bytes).
          if (writable) {
            try { await writable.close(); } catch { /* best effort */ }
            writable = undefined;
          }
          if (err instanceof Error && err.name === 'AbortError') {
            // Aborted via abortDownload/pauseDownload — state already set there.
          } else if (current()) {
            const msg = err instanceof Error ? err.message : i18n.t('uploads:failure.downloadError');
            const permanent = /\b4\d\d\b/.test(msg);
            get().setError(id, { message: msg, permanent });
          }
        } finally {
          if (liveDownloads.get(id) === controller) liveDownloads.delete(id);
        }

        return id;
      },

      abortDownload: (id) => {
        const transfer = get().get(id);
        if (transfer && !isCurrentTransfer(transfer)) { get().pauseDownload(id); return; }
        const c = liveDownloads.get(id);
        if (c) c.abort();
        liveDownloads.delete(id);
        get().setState_(id, 'aborted');
      },

      pauseDownload: (id) => {
        const c = liveDownloads.get(id);
        if (c) c.abort();
        liveDownloads.delete(id);
        get().setState_(id, 'paused');
      },

      resumeDownload: async (id) => {
        const t = get().get(id);
        if (!t || t.type !== 'download' || !t.sourceUrl) return;
        get().pauseDownload(id);
        if (!isCurrentTransfer(t)) return;
        const controller = new AbortController();
        liveDownloads.set(id, controller);
        const { sessionRevision } = useAuthStore.getState();
        const current = () => liveDownloads.get(id) === controller && !controller.signal.aborted
          && sessionRevision === useAuthStore.getState().sessionRevision
          && !!get().get(id) && isCurrentTransfer(get().get(id)!);
        const assertCurrent = () => { if (!current()) throw new DOMException('Download attempt changed', 'AbortError'); };
        let writable: FileSystemWritableFileStream | undefined;
        try {
        if (!t.destFileHandleId) {
          get().setError(id, { message: i18n.t('uploads:failure.noDestination'), permanent: true });
          return;
        }
        const handle = await getHandle(t.destFileHandleId);
        assertCurrent();
        if (!handle) {
          get().setError(id, { message: i18n.t('uploads:failure.destinationMissing'), permanent: true });
          return;
        }
        const perm = await ensurePermission(handle, 'readwrite');
        assertCurrent();
        if (perm !== 'granted') {
          get().setError(id, { message: i18n.t('uploads:failure.permissionDenied'), permanent: false });
          return;
        }
        const handleAny = handle as unknown as {
          getFile?: () => Promise<File>;
          createWritable?: (opts: { keepExistingData: boolean }) => Promise<FileSystemWritableFileStream>;
        };
        const fileNow = await handleAny.getFile!();
        assertCurrent();
        const offset = fileNow.size;
        writable = await handleAny.createWritable!({ keepExistingData: true });
        assertCurrent();
        await (writable as unknown as { seek: (pos: number) => Promise<void> }).seek(offset);
        assertCurrent();

        get().setState_(id, 'active');
          const resp = await fetch(t.sourceUrl, {
            signal: controller.signal,
            headers: { Range: `bytes=${offset}-` },
          });
          assertCurrent();
          if (!resp.ok && resp.status !== 206) throw new Error(i18n.t('uploads:failure.resumeFailed', { status: resp.status }));
          const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(resp.headers.get('Content-Range') ?? '');
          if ((offset > 0 && resp.status !== 206) || (resp.status === 206 && (!range
            || Number(range[1]) !== offset || Number(range[2]) < offset
            || (range[3] !== '*' && Number(range[2]) >= Number(range[3]))))) {
            throw new Error(i18n.t('uploads:failure.invalidResponse'));
          }
          const reader = resp.body!.getReader();
          let written = offset;
          for (;;) {
            const { value, done } = await reader.read();
            assertCurrent();
            if (done) break;
            await writable.write(value);
            assertCurrent();
            written += value.byteLength;
            get().updateProgress(id, written);
            set((s) => {
              const cur = s.transfers.get(id);
              if (!cur) return s;
              const next = new Map(s.transfers);
              next.set(id, { ...cur, bytesWrittenToDisk: written });
              return { transfers: next };
            });
          }
          await writable.close();
          writable = undefined;
          if (current()) get().setState_(id, 'completed');
        } catch (err) {
          // Flush partial bytes before bubbling out so the next resume's offset
          // (read via getFile().size) reflects what's actually on disk.
          try { await writable?.close(); } catch { /* best effort */ }
          if (current() && !(err instanceof Error && err.name === 'AbortError')) {
            const msg = err instanceof Error ? err.message : i18n.t('uploads:failure.downloadError');
            const permanent = /\b4\d\d\b/.test(msg);
            get().setError(id, { message: msg, permanent });
          }
        } finally {
          if (liveDownloads.get(id) === controller) liveDownloads.delete(id);
        }
      },

      restoreSession: async () => {
        if (!needsSessionRestoration) return;
        if (get().transfers.size === 0) { needsSessionRestoration = false; return; }
        // Do not consume the boot pass while /users/@me or ready is pending.
        // Consume before any handle await, so simultaneous confirmations cannot
        // start two probes and later profile/password updates never auto-resume.
        const { token, user } = useAuthStore.getState();
        if (token && user) needsSessionRestoration = false;
        await normalizeRehydratedTransfers();
      },
      pauseSession: () => {
        for (const t of get().transfers.values()) {
          if (t.state !== 'active' && t.state !== 'queued' && !uploadAttempts.has(t.id) && !liveDownloads.has(t.id)) continue;
          if (t.type === 'upload') get().pauseUpload(t.id);
          else get().pauseDownload(t.id);
        }
      },
      get: (id) => get().transfers.get(id),
      listVisible: () => Array.from(get().transfers.values()).filter((t) => t.tray && isCurrentTransfer(t)),
      listForChannel: (channelId) =>
        Array.from(get().transfers.values()).filter((t) => t.channelId === channelId && isCurrentTransfer(t)),
    });
    },
    {
      name: 'transferStore@v1',
      storage: mapAwareStorage,
      version: 1,
      // Only persist transfers that are meaningful to rehydrate:
      //   - completed uploads waiting for the deferred POST (have attachmentId)
      //   - in-flight uploads with a tusUploadUrl (resumable on reload)
      //   - failed transfers (user may want to retry / discard)
      // Drop active in-flight without a tusUrl (their state is lost), drop aborted (user discarded).
      partialize: (s) => ({
        transfers: new Map(
          Array.from(s.transfers.entries()).filter(([, t]) =>
            t.attachmentId !== undefined ||
            t.tusUploadUrl !== undefined ||
            t.state === 'failed' ||
            t.state === 'paused'
          )
        ),
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) return;
        needsSessionRestoration = true;
        // Normalize on the next tick so the store is fully wired before we mutate
        // it, and so async work (handle probe + auto-resume) doesn't block the
        // rehydrate path.
        queueMicrotask(() => {
          void useTransferStore.getState().restoreSession();
        });
      },
    },
  ),
);

/**
 * Boot-time normalization of rehydrated transfers.
 *
 * 1. Demotes any leaked 'active' state to 'paused' (defensive — partialize already
 *    filters most, but a transfer mid-progress can still slip through if it had a
 *    tusUploadUrl).
 * 2. Marks bytes-unrecoverable paused transfers as 'failed' with an actionable
 *    message — we have no in-memory File post-reload and no FS handle to reacquire
 *    bytes from, so showing a paused state would be misleading.
 * 3. For paused transfers with a stored handle whose permission is already
 *    'granted', silently auto-resumes. For 'prompt' / 'denied', leaves paused so
 *    the user's explicit Resume click provides the user-gesture for
 *    `requestPermission`.
 *
 * Idempotent — re-running is harmless.
 */
async function normalizeRehydratedTransfers(): Promise<void> {
  const store = useTransferStore.getState();
  const transfers = Array.from(store.transfers.values());

  for (const t of transfers) {
    // 1) Demote any leaked 'active' state — no live worker exists post-reload.
    if (t.state === 'active' || t.state === 'queued') {
      store.setState_(t.id, 'paused');
    }

    const current = useTransferStore.getState().get(t.id);
    if (!useAuthStore.getState().token || !current || !isCurrentTransfer(current)) continue;
    const revision = useAuthStore.getState().sessionRevision;
    const owned = () => revision === useAuthStore.getState().sessionRevision
      && useTransferStore.getState().get(t.id)?.state === 'paused'
      && isCurrentTransfer(current);

    // 2) Bytes-unrecoverable paused transfers → immediately fail.
    if (current.state === 'paused') {
      const isUpload = current.type === 'upload';
      const handleId = isUpload ? current.fileHandleId : current.destFileHandleId;
      if (!handleId) {
        if (isUpload && liveUploadFiles.has(current.id)) continue;
        store.setError(current.id, {
          message: isUpload
            ? i18n.t('uploads:failure.fileUnavailable')
            : i18n.t('uploads:failure.lostDownload'),
          permanent: true,
        });
        continue;
      }

      // 3) Auto-resume when permission is already 'granted'.
      try {
        const handle = await getHandle(handleId);
        if (!owned()) continue;
        if (!handle) {
          store.setError(current.id, {
            message: isUpload
              ? i18n.t('uploads:failure.uploadHandleMissing')
              : i18n.t('uploads:failure.downloadHandleMissing'),
            permanent: true,
          });
          continue;
        }
        const mode: 'read' | 'readwrite' = isUpload ? 'read' : 'readwrite';
        const perm = await queryHandlePermission(handle, mode);
        if (!owned()) continue;
        if (perm === 'granted') {
          // Use the live store reference so subsequent state changes are visible
          // to subscribers.
          if (isUpload) {
            void useTransferStore.getState().resumeUpload(current.id);
          } else {
            void useTransferStore.getState().resumeDownload(current.id);
          }
        }
        // perm === 'prompt' or 'denied' → user must click Resume to trigger
        // requestPermission with a user-gesture.
      } catch {
        // Probe failed (IDB unavailable, etc.) — leave paused. User can click
        // Resume to retry through the normal path.
      }
    }
  }
}
