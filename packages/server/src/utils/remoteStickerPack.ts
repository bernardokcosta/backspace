import { MAX_STICKER_NAME_LENGTH, MAX_STICKER_PACK_NAME_LENGTH, MAX_STICKER_PACK_DESC_LENGTH,
  MAX_STICKERS_PER_PACK, STICKER_ID_PATTERN, normalizeStickerName } from '@backspace/shared/src/stickers.js';

export const MAX_STICKER_PACK_METADATA_BYTES = 256 * 1024;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Malformed remote sticker pack response');
  return value as Record<string, unknown>;
}
function requiredName(value: unknown, max: number): string {
  const name = normalizeStickerName(value);
  if (!name || name.length > max) throw new Error('Malformed remote sticker pack name');
  return name;
}
function assetId(value: unknown): string {
  if (typeof value !== 'string' || !STICKER_ID_PATTERN.test(value)) throw new Error('Malformed remote sticker asset ID');
  return value;
}

/** Returns fully validated values, never a type assertion over peer JSON. */
export function parseRemoteStickerPack(value: unknown, expectedId: string) {
  const pack = record(value);
  if (pack.id !== expectedId || typeof pack.id !== 'string' || pack.id.length > 128) throw new Error('Remote sticker pack ID mismatch');
  if (!Array.isArray(pack.items) || pack.items.length > MAX_STICKERS_PER_PACK) throw new Error('Remote sticker pack exceeds item limit');
  const items = pack.items.map(value => {
    const item = record(value);
    if (typeof item.sortOrder !== 'number' || !Number.isSafeInteger(item.sortOrder) || item.sortOrder < 0) throw new Error('Malformed remote sticker order');
    return { assetId: assetId(item.assetId), name: requiredName(item.name, MAX_STICKER_NAME_LENGTH), sortOrder: item.sortOrder };
  });
  if (typeof pack.currentVersion !== 'number' || !Number.isSafeInteger(pack.currentVersion) || pack.currentVersion < 1) throw new Error('Malformed remote sticker version');
  if (pack.description != null && (typeof pack.description !== 'string' || pack.description.length > MAX_STICKER_PACK_DESC_LENGTH)) throw new Error('Malformed remote sticker description');
  return {
    id: pack.id,
    name: requiredName(pack.name, MAX_STICKER_PACK_NAME_LENGTH),
    description: typeof pack.description === 'string' ? pack.description.trim() || null : null,
    creatorName: pack.creatorName == null ? null : requiredName(pack.creatorName, MAX_STICKER_NAME_LENGTH),
    coverAssetId: pack.coverAssetId == null ? null : assetId(pack.coverAssetId),
    currentVersion: pack.currentVersion,
    items,
  };
}
