import { api } from '../api/client';

/** Strip the current upload endpoint prefix; leave bare and absolute filenames intact. */
export function stripUploadPrefix(filename: string): string {
  return filename.startsWith('/api/uploads/') ? filename.slice('/api/uploads/'.length) : filename;
}
/** A public upload URL; no peer client or bearer credentials are involved. */
export function uploadUrl(filename: string | null | undefined): string | null {
  if (!filename) return null;
  if (/^https?:\/\//i.test(filename)) return filename;
  return api.uploads.url(stripUploadPrefix(filename));
}
