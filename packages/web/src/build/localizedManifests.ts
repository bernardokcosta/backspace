import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import type { ManifestOptions } from 'vite-plugin-pwa';
import english from '../locales/en/common.json' with { type: 'json' };
import { availableLanguages, getLanguageDirection, type SupportedLanguage } from '../i18n/languages';

/** One install identity/template; only descriptive language varies. */
export const BASE_MANIFEST: Partial<ManifestOptions> = {
  name: 'Backspace Fork',
  short_name: 'Backspace Fork',
  description: english.app.description,
  display: 'standalone',
  start_url: '/',
  theme_color: '#0b0b10',
  background_color: '#0b0b10',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

export function localizedManifest(language: SupportedLanguage, description?: string): Partial<ManifestOptions> {
  const actual = description === undefined ? 'en' : language;
  return {
    ...BASE_MANIFEST,
    description: description ?? english.app.description,
    lang: actual === 'pt' ? 'pt-BR' : actual === 'zh' ? 'zh-Hans' : actual,
    dir: getLanguageDirection(actual),
  };
}

/** Static build assets plus their dev-server equivalent; no extra service worker. */
export function localizedManifests(): Plugin {
  let root = '';
  let base = '/';
  function manifest(language: SupportedLanguage) {
    const file = path.join(root, 'src/locales', language, 'common.json');
    let description: string | undefined;
    if (existsSync(file)) {
      const catalog = JSON.parse(readFileSync(file, 'utf8')) as { app?: { description?: unknown } };
      const value = catalog.app?.description;
      if (value !== undefined) {
        if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid app description in ${language}/common.json`);
        description = value;
      }
    }
    return localizedManifest(language, description);
  }
  return {
    name: 'backspace:localized-manifests',
    configResolved(config) { root = config.root; base = config.base; },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return { html, tags: [{ tag: 'meta', attrs: { name: 'description', content: english.app.description }, injectTo: 'head' }] };
      },
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split('?')[0];
        const language = availableLanguages.find(entry => pathname === `${base}manifest-${entry.code}.webmanifest`);
        if (!language) return next();
        try {
          response.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
          response.end(JSON.stringify(manifest(language.code)));
        } catch (error) { next(error); }
      });
    },
    generateBundle() {
      for (const { code } of availableLanguages) this.emitFile({ type: 'asset', fileName: `manifest-${code}.webmanifest`, source: JSON.stringify(manifest(code)) });
    },
  };
}
