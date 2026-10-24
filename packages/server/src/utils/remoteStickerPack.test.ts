import { describe, it, expect } from 'vitest';
import { parseRemoteStickerPack } from './remoteStickerPack.js';

const valid = () => ({ id: 'pack', name: '  Pack  ', description: '', creatorName: null, coverAssetId: null,
  currentVersion: 1, items: [{ assetId: 'a'.repeat(64), name: '  Happy  ', sortOrder: 0 }] });

describe('peer sticker metadata', () => {
  it('returns normalized values with an empty description cleared', () => {
    const parsed = parseRemoteStickerPack(valid(), 'pack');
    expect(parsed.name).toBe('Pack');
    expect(parsed.description).toBeNull();
    expect(parsed.items[0]?.name).toBe('Happy');
  });
  it.each([null, {}, [], { ...valid(), id: 'wrong' }, { ...valid(), currentVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid(), coverAssetId: '../file' }, { ...valid(), creatorName: 'a\nb' },
    { ...valid(), items: [{ assetId: null, name: 'Name', sortOrder: 0 }] },
    { ...valid(), items: [{ assetId: 'a'.repeat(64), sortOrder: 0 }] },
    { ...valid(), items: [{ assetId: 'a'.repeat(64), name: null, sortOrder: 0 }] },
    { ...valid(), items: [{ assetId: 'a'.repeat(64), name: 'Name', sortOrder: -1 }] },
  ])('rejects malformed metadata before producing writable values (%#)', payload => {
    expect(() => parseRemoteStickerPack(payload, 'pack')).toThrow();
  });
});
