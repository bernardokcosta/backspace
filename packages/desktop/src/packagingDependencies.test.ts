import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// Resolve from the real consumers, not pnpm's platform/peer-dependent store paths.
const desktopRequire = createRequire(path.resolve(__dirname, '../package.json'));
const packagerRequire = createRequire(desktopRequire.resolve('electron-builder'));
const builderRequire = createRequire(packagerRequire.resolve('app-builder-lib'));
const asarRequire = createRequire(builderRequire.resolve('@electron/asar'));
const universalRequire = createRequire(builderRequire.resolve('@electron/universal'));
const compareRequire = createRequire(universalRequire.resolve('dir-compare'));
const globRequire = createRequire(asarRequire.resolve('glob'));
const ejsRequire = createRequire(builderRequire.resolve('ejs'));
const jakeRequire = createRequire(ejsRequire.resolve('jake'));
const filelistRequire = createRequire(jakeRequire.resolve('filelist'));

interface LegacyGlobOptions {
  cwd: string;
  dot?: boolean;
  nodir?: boolean;
  ignore?: string[];
  nonull?: boolean;
  noprocess?: boolean;
  optimizationLevel?: number;
  braceExpandMax?: number;
}

const glob = asarRequire('glob') as {
  (pattern: string, options: LegacyGlobOptions, callback: (error: Error | null, files: string[]) => void): void;
  sync(pattern: string, options: LegacyGlobOptions): string[];
  GlobSync: new (pattern: string, options: LegacyGlobOptions) => {
    minimatch: { globParts: string[][] };
  };
};
const asar = builderRequire('@electron/asar') as {
  createPackageWithOptions(src: string, dest: string, options: { unpack?: string; unpackDir?: string }): Promise<void>;
  extractFile(archive: string, file: string): Buffer;
  statFile(archive: string, file: string): { unpacked?: boolean };
  uncacheAll(): void;
};
const compare = universalRequire('dir-compare') as {
  compareSync(left: string, right: string, options: { compareContent: boolean; includeFilter: string; excludeFilter: string }): { same: boolean };
};

let dir: string;
let source: string;

function write(root: string, relative: string, content = relative): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function globAsync(pattern: string, options: LegacyGlobOptions): Promise<string[]> {
  return new Promise((resolve, reject) => {
    glob(pattern, options, (error, files) => {
      if (error) reject(error);
      else resolve(files);
    });
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packaging-deps-'));
  source = path.join(dir, 'source');
  for (const file of ['dist/main.js', 'dist/.hidden.js', 'native/addon.node', 'resources/nested/data.json', 'ignored/skip.js']) {
    write(source, file);
  }
});

afterEach(() => {
  asar.uncacheAll();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('packaging dependency security upgrades', () => {
  it('resolves patched minimatch for modern and legacy consumers', () => {
    for (const consumer of [builderRequire, asarRequire, universalRequire, compareRequire, globRequire, filelistRequire]) {
      const { version } = consumer('minimatch/package.json') as { version: string };
      const [major, minor, patch] = version.split('.').map(Number);
      expect(major).toBe(11);
      if (minor === 0) expect(patch).toBeGreaterThanOrEqual(3);
    }
  });

  it('preserves recursive sync globbing, braces, dotfiles, ignores and nonull', () => {
    const options = { cwd: source, nodir: true, ignore: ['ignored/**'] };
    expect(glob.sync('**/*.{js,node}', options).sort()).toEqual(['dist/main.js', 'native/addon.node']);
    expect(glob.sync('**/*.{js,node}', { ...options, dot: true }).sort()).toEqual([
      'dist/.hidden.js', 'dist/main.js', 'native/addon.node',
    ]);
    expect(glob.sync('**/+(main|addon).@(js|node)', options).sort()).toEqual(['dist/main.js', 'native/addon.node']);
    expect(glob.sync('{missing,absent}/file', { cwd: source, nonull: true }).sort()).toEqual([
      'absent/file', 'missing/file',
    ]);
  });

  it('preserves callback globbing used by asar and rimraf', async () => {
    const files = await globAsync('**/*.{js,node}', { cwd: source, nodir: true, dot: true, ignore: ['ignored/**'] });
    expect(files.sort()).toEqual(['dist/.hidden.js', 'dist/main.js', 'native/addon.node']);
  });

  it.each(['sync', 'callback'] as const)('preserves explicit dotfile brace alternatives in %s globbing', async mode => {
    for (const file of ['.gitignore', '.gitattributes', '.dockerignore']) write(source, file);
    const options = { cwd: source, nodir: true };
    const pattern = '{.git*,.docker*}';
    const files = mode === 'sync' ? glob.sync(pattern, options) : await globAsync(pattern, options);
    expect(files.sort()).toEqual(['.dockerignore', '.gitattributes', '.gitignore']);
  });

  it.each(['sync', 'callback'] as const)('preserves every unmatched brace alternative in %s globbing', async mode => {
    const options = { cwd: source, nonull: true };
    const pattern = 'missing/*.{node,js}';
    const files = mode === 'sync' ? glob.sync(pattern, options) : await globAsync(pattern, options);
    expect(files.sort()).toEqual(['missing/*.js', 'missing/*.node']);
  });

  it('retains minimatch preprocessing amplification limits', () => {
    // minimatch11.0.5 rejects the expansion instead of returning a truncated
    // pattern set. A RangeError is the intended fail-closed security boundary.
    expect(() => new glob.GlobSync(`pre/${'**/../a/b/'.repeat(6)}file`, {
      cwd: source,
      noprocess: true,
      optimizationLevel: 2,
      braceExpandMax: 4,
    })).toThrowError(new RangeError("optimizationLevel 2: too many patterns from '**/..'"));
  });

  it('packs real files while unpacking native modules and directory patterns', async () => {
    const archive = path.join(dir, 'app.asar');
    await asar.createPackageWithOptions(source.replace(/\\/g, '/'), archive, {
      unpack: '*.node',
      unpackDir: 'resources{,/**}',
    });
    expect(asar.extractFile(archive, 'dist/main.js').toString()).toBe('dist/main.js');
    expect(asar.extractFile(archive, 'dist/.hidden.js').toString()).toBe('dist/.hidden.js');
    for (const file of ['native/addon.node', 'resources/nested/data.json']) {
      expect(asar.statFile(archive, path.normalize(file)).unpacked).toBe(true);
      expect(fs.readFileSync(path.join(`${archive}.unpacked`, file), 'utf8')).toBe(file);
    }
  });

  it('keeps dir-compare basename includes, dotfiles and directory exclusions', () => {
    const other = path.join(dir, 'other');
    fs.cpSync(source, other, { recursive: true });
    write(other, 'ignored/skip.js', 'excluded change');
    write(other, 'resources/nested/data.json', 'not included');
    const options = { compareContent: true, includeFilter: '*.js,*.node', excludeFilter: 'ignored' };
    expect(compare.compareSync(source, other, options).same).toBe(true);
    write(other, 'dist/.hidden.js', 'included change');
    expect(compare.compareSync(source, other, options).same).toBe(false);
  });

  it('preserves electron-builder positive and negative native payload filters', () => {
    const { FileMatcher } = builderRequire('./fileMatcher') as {
      FileMatcher: new (from: string, to: string, expand: (value: string) => string, patterns: string[]) => {
        createFilter(): (file: string, stat: fs.Stats) => boolean;
      };
    };
    const matcher = new FileMatcher(source, path.join(dir, 'destination'), value => value, [
      '**/*', '!**/node_modules/uiohook-napi/build/**', '!**/node_modules/uiohook-napi/bin/**',
    ]);
    const filter = matcher.createFilter();
    for (const file of ['dist/main.js', 'dist/.hidden.js', 'node_modules/uiohook-napi/prebuilds/win32-x64/addon.node']) {
      write(source, file);
      const absolute = path.join(source, file);
      expect(filter(absolute, fs.statSync(absolute))).toBe(true);
    }
    for (const file of ['node_modules/uiohook-napi/build/Release/addon.node', 'node_modules/uiohook-napi/bin/addon.node']) {
      write(source, file);
      const absolute = path.join(source, file);
      expect(filter(absolute, fs.statSync(absolute))).toBe(false);
    }
  });

  it('keeps ejs rendering and filelist matching through its jake dependency', () => {
    const ejs = builderRequire('ejs') as {
      render(template: string, data: Record<string, string>): string;
    };
    const { FileList } = jakeRequire('filelist') as {
      FileList: new (pattern: string, options: { windowsPathsNoEscape: boolean }) => { toArray(): string[] };
    };
    expect(ejs.render('<%= name %>', { name: 'packaging-ok' })).toBe('packaging-ok');
    const files = new FileList(path.join(source, '**', '*.node'), { windowsPathsNoEscape: true }).toArray();
    expect(files).toEqual([path.join(source, 'native', 'addon.node').replace(/\\/g, '/')]);
  });
});
