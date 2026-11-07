import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { JUNO_COLORS, type JunoFace } from '@backspace/shared/src/juno';
import { junoCardUrl, JUNO_ASSETS } from './junoAssets';

const root = path.resolve(import.meta.dirname, '../../../public/games/juno');
interface Manifest {
  files: { path: string; sha256: string; bytes: number; sourceFile?: string; sourceSha256?: string }[];
  memoryAudio: { path: string; sha256: string; sourceSha256: string; bytes: number; durationSeconds: number };
}
describe('supplied Juno asset inventory', () => {
  it('preserves the supplied memory media provenance and serves real Vorbis bytes', () => {
    const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')) as Manifest;
    expect(manifest.files.find(f => f.path === 'cards/memory.webp')).toMatchObject({
      sourceFile: 'Carta cósmica da memória nebulosa.png', sourceSha256: '3c8c19c8ff6a0d4a234645993ce35aac5289d12b83eb06135e24a09b97be2f09',
    });
    const audio = manifest.memoryAudio, bytes = readFileSync(path.resolve(root, '../..', audio.path.slice(1)));
    expect(bytes.subarray(0, 4).toString()).toBe('OggS'); expect(bytes.includes(Buffer.from('vorbis'))).toBe(true);
    expect(bytes.length).toBe(audio.bytes); expect(createHash('sha256').update(bytes).digest('hex')).toBe(audio.sha256);
    expect(audio.sourceSha256).toBe('77980fab39415557371636d3bd81c27d6fc3ad7f3361d325bc42eac022584240');
    expect(audio.durationSeconds).toBeGreaterThan(2.7); expect(audio.durationSeconds).toBeLessThan(3);
  });
  it('covers every legal face independently of opaque runtime ids', () => {
    const faces: JunoFace[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2'];
    for (const color of JUNO_COLORS) for (const face of faces) expect(existsSync(path.join(root, junoCardUrl({ id: 'not-a-path', color, face }).replace('/games/juno/', '')))).toBe(true);
    for (const face of ['wild', 'draw4', 'memory'] as const) expect(existsSync(path.join(root, junoCardUrl({ id: 'opaque', color: null, face }).replace('/games/juno/', '')))).toBe(true);
    expect(junoCardUrl()).toBe('/games/juno/cards/back.webp');
  });
  it('ships the approved original hammer and its separate resting crop', () => {
    const original = readFileSync(path.join(root, JUNO_ASSETS.hammer.replace('/games/juno/', '')));
    expect(createHash('sha256').update(original).digest('hex')).toBe('782e92bc0e255568f8001b0af6eb6f542a7d849d4390ea117daeacd3e4f25db2');
    expect(existsSync(path.join(root, JUNO_ASSETS.hammerStill.replace('/games/juno/', '')))).toBe(true);
  });
  it('ships 55 original faces and one back, all hashed and passive', () => {
    const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')) as Manifest;
    const cards = manifest.files.filter(file => file.path.startsWith('cards/'));
    expect(cards).toHaveLength(56); expect(cards.some(f => f.path === 'cards/back.webp')).toBe(true);
    expect(new Set(manifest.files.map(f => f.path)).size).toBe(manifest.files.length);
    for (const file of manifest.files) {
      expect(file.path).not.toMatch(/\.\.|preview|previa|demo|\.png$/i);
      expect(existsSync(path.join(root, file.path))).toBe(true);
      const data = readFileSync(path.join(root, file.path));
      expect(data.length).toBe(file.bytes); expect(createHash('sha256').update(data).digest('hex')).toBe(file.sha256);
      if (file.path.endsWith('.svg')) expect(data.toString()).not.toMatch(/<script|\bon\w+\s*=|(?:href|src)=["'](?:https?:|data:|javascript:)/i);
    }
  });
});
