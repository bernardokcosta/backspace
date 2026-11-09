import { describe, expect, it } from 'vitest';
import { BASE_MANIFEST, localizedManifest, localizedManifests } from './localizedManifests';

describe('localized app install metadata', () => {
  it('renames descriptive metadata without creating another PWA identity', () => {
    expect(BASE_MANIFEST).toMatchObject({ name: 'Veyvox', short_name: 'Veyvox', start_url: '/' });
    expect(BASE_MANIFEST.id).toBeUndefined();
    expect(BASE_MANIFEST.scope).toBeUndefined();
  });
  it('uses translated descriptions without changing install identity or icons', () => {
    const manifest = localizedManifest('pt', 'Descrição em português');
    expect(manifest).toMatchObject({ lang: 'pt-BR', dir: 'ltr', description: 'Descrição em português' });
    for (const key of ['id', 'start_url', 'name', 'short_name', 'icons', 'display']) expect(manifest[key]).toEqual(BASE_MANIFEST[key]);
    expect(localizedManifest('ar', 'وصف عربي')).toMatchObject({ lang: 'ar', dir: 'rtl' });
  });
  it('marks English fallback honestly when a future locale has no description yet', () => {
    expect(localizedManifest('fr')).toMatchObject({ lang: 'en', dir: 'ltr', description: BASE_MANIFEST.description });
    expect(localizedManifests()).toMatchObject({ name: 'veyvox:localized-manifests' });
  });
});
