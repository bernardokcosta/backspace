// Ad-hoc code signing fallback for macOS builds.
//
// Why this is needed:
//   electron-builder only signs when it can resolve a signing identity. Without
//   an Apple Developer ID, `MacPackager.sign()` bails out before signing at all
//   (`findIdentity()` -> null -> `reportError()` -> return false), so the
//   packaged bundle keeps only the linker-generated ad-hoc signatures that ship
//   inside the prebuilt Electron binaries. Packaging then invalidates those:
//   it renames the executable, rewrites Info.plist, injects app.asar, and
//   (via afterPack.js) deletes files out of Contents/Resources.
//
//   The result is not merely unsigned, it is *invalid*:
//     "code has no resources but signature indicates they must be present"
//   macOS reports an invalid signature as "Backspace.app is damaged and can't
//   be opened. You should move it to the Trash." — a dead end, with no "Open
//   Anyway" affordance anywhere in the UI.
//
// What this does:
//   Re-seals the bundle with an ad-hoc signature, giving it a real
//   Contents/_CodeSignature, the correct bundle identifier, and a bound
//   Info.plist. The app is still unnotarized, so first launch shows the usual
//   Gatekeeper prompt — but that prompt is bypassable (System Settings ->
//   Privacy & Security -> Open Anyway) and the app runs afterwards.
//
// What this does NOT do:
//   Ad-hoc signatures carry no team identifier, so macOS auto-update stays
//   unavailable and the cdhash changes every release, meaning macOS drops the
//   Input Monitoring / Screen Recording grants on each update. Only a
//   Developer ID certificate plus notarization fixes those.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// `codesign --sign -` never contacts a timestamp server; pinning it to none
// keeps the build hermetic rather than relying on that default.
const AD_HOC_SIGN_ARGS = ['--force', '--sign', '-', '--timestamp=none'];

const MAC_HELPERS = [
  { directory: 'Frameworks', suffix: ' Helper', required: true },
  { directory: 'Frameworks', suffix: ' Helper (Renderer)', required: true },
  { directory: 'Frameworks', suffix: ' Helper (GPU)', required: true },
  { directory: 'Frameworks', suffix: ' Helper (Plugin)', required: true },
  { directory: 'Frameworks', suffix: ' Helper EH', required: false },
  { directory: 'Frameworks', suffix: ' Helper NP', required: false },
  { directory: path.join('Library', 'LoginItems'), suffix: ' Login Helper', required: false },
];

function readPlistValue(file, key, execute) {
  return execute('plutil', ['-extract', key, 'raw', '-o', '-', file], { encoding: 'utf8' }).trim();
}

function checkHelperPrefix(name) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[/\\\u0000-\u001f]/.test(name)) {
    throw new Error('Invalid macOS helper name');
  }
  return name;
}

function helperPaths(appPath, prefix, helper) {
  const name = prefix + helper.suffix;
  const bundle = path.join(appPath, 'Contents', helper.directory, name + '.app');
  return { name, bundle, plist: path.join(bundle, 'Contents', 'Info.plist'), executable: path.join(bundle, 'Contents', 'MacOS', name) };
}

function checkHelper(files, execute) {
  if (!fs.lstatSync(files.bundle).isDirectory() || !fs.lstatSync(files.executable).isFile() || !fs.lstatSync(files.plist).isFile()
    || readPlistValue(files.plist, 'CFBundleExecutable', execute) !== files.name) {
    throw new Error('Inconsistent macOS helper executable');
  }
}

/** Read the actual packaged layout that Electron resolves from CFBundleName.
 * Neither a valid codesign seal nor the main executable's name proves this.
 */
function verifyMacHelperLayout(appPath, execute = execFileSync) {
  const prefix = checkHelperPrefix(readPlistValue(path.join(appPath, 'Contents', 'Info.plist'), 'CFBundleName', execute));
  let count = 0;
  for (const helper of MAC_HELPERS) {
    const files = helperPaths(appPath, prefix, helper);
    if (!fs.existsSync(files.bundle)) {
      if (helper.required) throw new Error('Missing macOS helper for retained CFBundleName');
      continue;
    }
    checkHelper(files, execute);
    count++;
  }
  return count;
}

/** electron-builder 26 names helpers from sanitizedProductName even when
 * executableName is pinned. Electron 45 instead resolves them from CFBundleName.
 * Keep that installed/crypto name; align only helper paths/executable metadata,
 * before fuses/signing, preserving display names, identifiers and binary bytes.
 */
function alignMacHelperNames(appPath, productName, execute = execFileSync) {
  const sourcePrefix = checkHelperPrefix(productName);
  const targetPrefix = checkHelperPrefix(readPlistValue(path.join(appPath, 'Contents', 'Info.plist'), 'CFBundleName', execute));
  const planned = [];
  for (const helper of MAC_HELPERS) {
    const source = helperPaths(appPath, sourcePrefix, helper);
    const target = helperPaths(appPath, targetPrefix, helper);
    if (sourcePrefix === targetPrefix || !fs.existsSync(source.bundle)) {
      if (!fs.existsSync(target.bundle)) {
        if (helper.required) throw new Error('Missing macOS helper during packaging');
        continue;
      }
      checkHelper(target, execute);
      continue;
    }
    if (fs.existsSync(target.bundle)) throw new Error('Conflicting macOS helper destination');
    checkHelper(source, execute);
    if (fs.existsSync(path.join(path.dirname(source.executable), target.name))) throw new Error('Conflicting macOS helper executable');
    planned.push({ source, target });
  }
  // Complete all validation before the first mutation; never merge/overwrite a
  // destination. A later filesystem/plutil failure aborts packaging, not signing.
  for (const { source, target } of planned) {
    fs.renameSync(source.executable, path.join(path.dirname(source.executable), target.name));
    execute('plutil', ['-replace', 'CFBundleExecutable', '-string', target.name, source.plist], { encoding: 'utf8' });
    fs.renameSync(source.bundle, target.bundle);
  }
  verifyMacHelperLayout(appPath, execute);
  return planned.length;
}

/**
 * True when electron-builder has a real identity to sign with, in which case
 * this fallback must stay out of the way and let it sign properly.
 *
 * @returns {boolean}
 */
function hasRealSigningIdentity() {
  return Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
}

/**
 * Collects Mach-O files under Contents/Resources.
 *
 * `codesign --deep` only reaches code in the standard nested locations
 * (Frameworks, Helpers, PlugIns, XPCServices). Native modules unpacked to
 * Resources/app.asar.unpacked sit outside those, so they are sealed as plain
 * resources and never signed. Signing them explicitly first keeps every
 * Mach-O in the bundle consistently signed across both architectures.
 *
 * @param {string} dir Directory to walk.
 * @returns {string[]} Absolute paths of Mach-O files found.
 */
function collectResourceMachO(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      found.push(...collectResourceMachO(full));
    } else if (entry.isFile() && (entry.name.endsWith('.node') || entry.name.endsWith('.dylib'))) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Ad-hoc signs a packaged .app bundle in place and verifies the result.
 *
 * Verification runs here rather than only in CI so an unusable bundle fails the
 * build before electron-builder packages it into a .dmg/.zip and publishes it.
 *
 * @param {string} appPath Absolute path to the .app bundle.
 * @returns {void}
 * @throws {Error} If signing or verification fails.
 */
function adhocSignMacApp(appPath) {
  const resourcesDir = path.join(appPath, 'Contents', 'Resources');

  for (const binary of collectResourceMachO(resourcesDir)) {
    execFileSync('codesign', [...AD_HOC_SIGN_ARGS, binary], { stdio: 'inherit' });
    console.log(`[macSign] Ad-hoc signed ${path.relative(appPath, binary)}`);
  }

  // `--deep` is discouraged for distribution signing because it applies one set
  // of entitlements to every nested binary. An ad-hoc signature carries no
  // entitlements, so that concern does not apply here, and it is the only
  // single-pass way to seal the Electron framework and helper apps.
  execFileSync('codesign', [...AD_HOC_SIGN_ARGS, '--deep', appPath], { stdio: 'inherit' });
  console.log(`[macSign] Ad-hoc signed bundle ${path.basename(appPath)}`);

  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  console.log(`[macSign] Signature verified for ${path.basename(appPath)}`);
}

/**
 * afterPack entry point. Signs the bundle unless a real identity is configured
 * or the build host cannot run codesign.
 *
 * @param {string} appPath Absolute path to the .app bundle.
 * @returns {void}
 */
function signMacAppIfUnsigned(appPath) {
  if (hasRealSigningIdentity()) {
    console.log('[macSign] Signing identity configured — leaving signing to electron-builder');
    return;
  }

  if (process.platform !== 'darwin') {
    console.warn(
      '[macSign] Cannot ad-hoc sign from a non-macOS host — this bundle will be rejected by Gatekeeper as damaged'
    );
    return;
  }

  if (!fs.existsSync(appPath)) {
    throw new Error(`[macSign] Expected app bundle at ${appPath}, but it does not exist`);
  }

  adhocSignMacApp(appPath);
}

module.exports = { signMacAppIfUnsigned, alignMacHelperNames, verifyMacHelperLayout };
