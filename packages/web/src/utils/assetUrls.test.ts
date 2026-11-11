import { describe, expect, it, vi } from 'vitest';
vi.mock('../api/client', () => ({ api: { uploads: { url: (filename: string) => `/api/uploads/${filename}` } } }));
import { uploadUrl } from './assetUrls';
import * as assets from './assetUrls';
describe('native upload URLs', () => {
  it('resolves bare and prefixed filenames against the current API', () => {
    expect(uploadUrl('native.webp')).toBe('/api/uploads/native.webp'); expect(uploadUrl('/api/uploads/native.webp')).toBe('/api/uploads/native.webp');
  });
  it('leaves public absolute asset URLs intact, without attaching credentials', () => { expect(uploadUrl('https://cdn.invalid/public.webp')).toBe('https://cdn.invalid/public.webp'); });
  it('is null without a file', () => { expect(uploadUrl(null)).toBeNull(); expect(uploadUrl(undefined)).toBeNull(); expect(uploadUrl('')).toBeNull(); });
  it('exports no remote asset or identity mutators', () => {
    for (const name of ['uploadUrlOn', 'resolveAssetUrl', 'normalizeUserAssets', 'normalizeMessageAssets']) expect(assets).not.toHaveProperty(name);
  });
});
