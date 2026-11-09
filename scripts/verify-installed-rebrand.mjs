/** Destructive OS acceptance is opt-in and restricted to disposable hosted VMs.
 * Never import this module to perform an install; only the guarded CLI does so.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export function requireDisposableRunner(env, platform = process.platform) {
  const names = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted'
    || env.VEYVOX_INSTALL_ACCEPTANCE !== '1' || !/^\d+$/.test(env.GITHUB_RUN_ID ?? '')
    || !env.RUNNER_TEMP || !env.GITHUB_WORKSPACE || env.RUNNER_OS !== names[platform]) {
    throw new Error('Installed acceptance runs only on disposable GitHub-hosted runners with explicit opt-in');
  }
}

// Digests measured from the published, immutable 1.16.8 assets before rename.
export const BASELINES = Object.freeze({
  'win32-x64': ['win-x64.exe', '444f6f792c4b7b3fb2c3fa93afbea40cec3b91caae5e8a142a541c50d6af2c29'],
  'win32-arm64': ['win-arm64.exe', '49b34edff9963c5413240b3991b605afc9a8e0282f3d56d47e769e99452f7e22'],
  'darwin-x64': ['mac-x64.dmg', '83d6624ccb086839c7ddc135d2cdcb58ab48ec0de36a501c1d84ff1ca734fc8a'],
  'darwin-arm64': ['mac-arm64.dmg', '5f3f790712139e3589ef8f5b51c006c7f3c9ae9e9da50ad585a49b44bb4c4fcc'],
  'linux-x64': ['linux-amd64.deb', 'ddda87cb5de34a7fb4813e1cd35d052236d12f9c84cd4f9a2274c7381cd88e00'],
  'linux-arm64': ['linux-arm64.deb', 'a5077d98036c53d6bd796516669f09b560851972421240244144de1df8dba3f0'],
});
const APPIMAGES = {
  x64: ['linux-x86_64.AppImage', 'c900d1f483d707b2917cd67c966b0adb89a2cc3a813f5c6c161bf039426cefe4'],
  arm64: ['linux-arm64.AppImage', 'ee3cb04da0f8fbb3ff437e229093bc905f992a72ffdb05182ce8e32175b0eff4'],
};

export function assertInstalledReport(report, phase, version, startup) {
  const checks = {
    ok: report?.ok === true, phase: report?.phase === phase, version: report?.version === version,
    token: report?.token === 'synthetic-session', language: report?.language === 'auto',
    pending: report?.pending === 'synthetic-pending', cookie: report?.cookie === 'synthetic-session',
    instances: report?.instances === 'synthetic-peer', scale: report?.scale === 200, music: report?.music === 20,
    legacy: report?.legacy === true, canonical: phase.endsWith('seed') || report?.canonical === true,
    // Electron explicitly documents visible as the initial renderer state of a
    // show:false BrowserWindow. This is metadata, NOT an OS visibility assertion.
    documentVisibility: ['visible', 'hidden'].includes(report?.documentVisibility),
    startup: startup === undefined || (report?.startup?.openAtLogin === startup && report.startup.startMinimized === true),
  };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  // Fixed field names only: never log a token, cookie, body or arbitrary text.
  if (failed.length) throw new Error(`Installed ${phase} failed checks: ${failed.join(', ')}`);
}

const run = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const powershell = script => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; ${script}`]);
const quotePS = value => `'${value.replaceAll("'", "''")}'`;
async function exists(file) { try { await fs.lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }

async function windowsIdentity() {
  return JSON.parse(powershell(`
    $entries = @(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' |
      Where-Object { $_.DisplayName -match '^(Backspace Fork|Veyvox)( |$)' });
    if ($entries.Count -ne 1) { throw 'Expected one fork uninstall entry' };
    $entry = $entries[0];
    $location = (Get-ItemProperty ("HKCU:\\Software\\" + $entry.PSChildName)).InstallLocation;
    if (-not $location) { throw 'Missing installer InstallLocation' };
    $shell = New-Object -ComObject WScript.Shell;
    $roots = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('StartMenu'));
    $explorer = New-Object -ComObject Shell.Application;
    $shortcuts = @($roots | ForEach-Object { Get-ChildItem $_ -Filter '*.lnk' -Recurse } |
      ForEach-Object { $link = $shell.CreateShortcut($_.FullName); if ($link.TargetPath -eq (Join-Path $location 'Backspace Fork.exe')) {
        $item = $explorer.Namespace($_.DirectoryName).ParseName($_.Name);
        [pscustomobject]@{ name=$_.Name; aumid=$item.ExtendedProperty('System.AppUserModel.ID') }
      } });
    [pscustomobject]@{ id=$entry.PSChildName; location=$location; version=$entry.DisplayVersion; shortcuts=$shortcuts } | ConvertTo-Json -Compress
  `));
}

async function install(file, evidence, before) {
  if (process.platform === 'win32') {
    // Let the unchanged GUID select the existing directory. Never force a new
    // /D location during replacement. Silent mode does not run the app.
    powershell(`$p=Start-Process -FilePath ${quotePS(file)} -ArgumentList '/S','/currentuser' -Wait -PassThru; if ($p.ExitCode -ne 0) { throw 'NSIS failed' }`);
    const identity = await windowsIdentity();
    if (before && (identity.id !== before.id || identity.location !== before.location)) throw new Error('NSIS created a different installation');
    if (!identity.shortcuts.length || identity.shortcuts.some(link => !/^(?:Backspace Fork|Veyvox)\.lnk$/.test(link.name)
      || link.aumid !== 'io.github.bernardokcosta.backspacefork') || (before && identity.shortcuts.length !== before.shortcuts.length)) throw new Error('Missing/duplicated fork shortcut or changed AUMID');
    return { identity, executable: path.join(identity.location, 'Backspace Fork.exe'), resources: path.join(identity.location, 'resources') };
  }
  if (process.platform === 'darwin') {
    const mount = await fs.mkdtemp(path.join(evidence, 'mount-'));
    run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, file]);
    const destination = path.join(os.homedir(), 'Applications', 'Backspace Fork.app');
    try {
      const source = path.join(mount, 'Backspace Fork.app');
      const plist = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', path.join(source, 'Contents/Info.plist')]));
      if (plist.CFBundleIdentifier !== 'io.github.bernardokcosta.backspacefork'
        || plist.CFBundleName !== 'Backspace Fork') throw new Error('macOS early bundle/crypto identity changed');
      if (before && plist.CFBundleDisplayName !== 'Veyvox') throw new Error('Missing macOS display brand');
      const schemes = plist.CFBundleURLTypes?.flatMap(type => type.CFBundleURLSchemes ?? []) ?? [];
      for (const scheme of before ? ['veyvox', 'backspace'] : ['backspace']) if (!schemes.includes(scheme)) throw new Error('Missing macOS protocol registration');
      await fs.mkdir(path.dirname(destination), { recursive: true });
      if (before) await fs.rename(destination, path.join(evidence, 'baseline-bundle.app'));
      else if (await exists(destination)) throw new Error('Refusing existing macOS app');
      run('ditto', [source, destination]);
      run('codesign', ['--verify', '--deep', '--strict', destination]);
      return { identity: { id: plist.CFBundleIdentifier, location: destination, version: plist.CFBundleShortVersionString },
        executable: path.join(destination, 'Contents/MacOS/Backspace Fork'), resources: path.join(destination, 'Contents/Resources') };
    } finally { run('hdiutil', ['detach', mount]); }
  }
  const identity = run('dpkg-deb', ['-f', file, 'Package']);
  if (identity !== 'backspace-fork') throw new Error('Debian package replacement identity changed');
  run('sudo', ['apt-get', 'install', '-y', file]);
  const files = run('dpkg-query', ['-L', identity]).split('\n');
  const executable = files.find(name => /^\/opt\/[^/]+\/Backspace Fork$/.test(name));
  const desktops = files.filter(name => /^\/usr\/share\/applications\/[^/]+\.desktop$/.test(name));
  if (!executable || desktops.length !== 1 || (before && desktops[0] !== before.desktop)) throw new Error('Debian executable/desktop replacement changed');
  const desktop = await fs.readFile(desktops[0], 'utf8');
  for (const scheme of before ? ['veyvox', 'backspace'] : ['backspace']) if (!desktop.includes(`x-scheme-handler/${scheme}`)) throw new Error('Missing Linux protocol registration');
  if (before && before.location !== executable && await exists(before.location)) throw new Error('Old Debian binary survived as a parallel installation');
  return { identity: { id: identity, location: executable, desktop: desktops[0], version: run('dpkg-query', ['-W', '-f=${Version}', identity]) },
    executable, resources: path.join(path.dirname(executable), 'resources') };
}

function verifyWindowsRegistrations(installed, candidate, startup) {
  if (process.platform !== 'win32') return;
  // These registrations are performed by production main on first launch, not
  // guaranteed by a silent NSIS install. Check after that real process exits.
  for (const scheme of candidate ? ['veyvox', 'backspace'] : ['backspace']) {
    const command = powershell(`(Get-Item ${quotePS(`HKCU:\\Software\\Classes\\${scheme}\\shell\\open\\command`)}).GetValue('')`);
    if (!command.includes(installed.executable)) throw new Error('Protocol points at a different executable');
  }
  const command = powershell(`(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run').'Backspace Fork'`);
  if (!command.includes(installed.executable) || !command.includes('--hidden')) throw new Error('Startup executable/hidden argument was not preserved');
  if (!startup) {
    const disabled = powershell(`(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run').'Backspace Fork'[0]`);
    if (disabled !== '3') throw new Error('OS-disabled startup was re-enabled');
  }
}

function appDataPath() {
  if (process.platform === 'win32') return process.env.APPDATA;
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library/Application Support');
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

async function verifyEncryptedCookie(profile) {
  const { DatabaseSync } = await import('node:sqlite');
  const file = (await exists(path.join(profile, 'Network/Cookies'))) ? path.join(profile, 'Network/Cookies') : path.join(profile, 'Cookies');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare("SELECT value, encrypted_value FROM cookies WHERE name='session' AND host_key='127.0.0.1'").get();
    if (!row || row.value !== '' || !row.encrypted_value?.length) throw new Error('Cookie encryption was not established');
    // Chromium Linux v10 means the hard-coded basic fallback, not a keyring.
    if (process.platform === 'linux' && Buffer.from(row.encrypted_value).subarray(0, 3).toString() !== 'v11') throw new Error('Linux cookie is not protected by the OS keyring');
  } finally { db.close(); }
}

async function launchAndVerify(installed, phase, version, state, evidence) {
  state.phase = phase; state.version = version;
  let timer, child;
  const log = await fs.open(path.join(evidence, `${phase}.log`), 'wx');
  try {
    const report = new Promise((resolve, reject) => {
      state.report = { resolve, reject };
    });
    const env = { ...process.env, ...installed.env };
    // Never override the production profile with --user-data-dir/BACKSPACE_URL.
    delete env.BACKSPACE_URL; delete env.ELECTRON_RUN_AS_NODE;
    for (const name of Object.keys(env)) if (/(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY)/i.test(name)) delete env[name];
    child = spawn(installed.executable, ['--hidden', `--proxy-server=${state.origin}`, '--proxy-bypass-list=127.0.0.1'],
      { env, stdio: ['ignore', log.fd, log.fd], windowsHide: true });
    const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Installed process exited ${code}`))); });
    const result = await Promise.race([Promise.all([report, exit]).then(([value]) => value),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Installed ${phase} report/clean quit timed out`)), 45_000); })]);
    clearTimeout(timer);
    return result;
  } finally {
    clearTimeout(timer); state.report = null;
    if (child?.pid && child.exitCode === null) {
      // Only the exact process tree started by this harness, never a name glob.
      if (process.platform === 'win32') run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']);
      else child.kill('SIGKILL');
    }
    await log.close();
  }
}

export async function verifyInstalledRebrand(args) {
  requireDisposableRunner(process.env); // Must precede argument parsing/IO/OS changes.
  const { values } = parseArgs({ args, options: { directory: { type: 'string' } }, strict: true, allowPositionals: false });
  if (!values.directory) throw new Error('Missing candidate --directory');
  const baseline = BASELINES[`${process.platform}-${process.arch}`];
  if (!baseline) throw new Error('No matching native baseline');
  const evidence = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP, 'veyvox-installed-'));
  const baselineName = `Backspace-Fork-1.16.8-${baseline[0]}`;
  const version = JSON.parse(await fs.readFile(new URL('../packages/desktop/package.json', import.meta.url))).version;
  const candidate = path.resolve(values.directory, `Veyvox-${version}-${baseline[0]}`);
  await fs.access(candidate);
  const appData = appDataPath();
  if (!appData) throw new Error('Unknown OS appData');
  const profile = path.join(appData, 'Backspace Fork');
  for (const file of [profile, path.join(appData, '@backspace/desktop'), path.join(appData, 'Veyvox'), path.join(appData, 'Backspace')]) {
    if (await exists(file)) throw new Error('Refusing pre-existing profile on acceptance runner');
  }
  if (process.platform === 'win32') powershell(`if (@(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '^(Backspace Fork|Veyvox)( |$)' }).Count) { throw 'Refusing existing installation' }`);
  if (process.platform === 'linux' && run('sh', ['-c', "dpkg-query -W -f='${db:Status-Status}' backspace-fork 2>/dev/null || true"]) === 'installed') throw new Error('Refusing existing Debian install');
  run('gh', ['release', 'download', 'v1.16.8', '--repo', 'bernardokcosta/backspace', '--pattern', baselineName, '--dir', evidence]);
  const oldFile = path.join(evidence, baselineName);
  if (createHash('sha256').update(await fs.readFile(oldFile)).digest('hex') !== baseline[1]) throw new Error('Historical installer SHA-256 mismatch');
  const state = { phase: '', report: null, origin: '' };
  const html = await fs.readFile(new URL('./fixtures/installed-rebrand.html', import.meta.url));
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.headers.host !== new URL(state.origin).host) { response.writeHead(403).end(); return; }
    if (request.method === 'GET' && request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end(html); return; }
    if (request.method === 'GET' && request.url === '/config') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ phase: state.phase, version: state.version, enableStartup: state.enableStartup, disableStartup: state.disableStartup })); return; }
    if (request.method !== 'POST' || request.url !== '/report' || request.headers.origin !== state.origin || !state.report) { response.writeHead(404).end(); return; }
    try {
      let size = 0; const chunks = [];
      for await (const chunk of request) { size += chunk.length; if (size > 8192) throw new Error('Oversized installed report'); chunks.push(chunk); }
      const report = JSON.parse(Buffer.concat(chunks).toString());
      assertInstalledReport(report, state.phase, state.version, state.startup);
      state.report.resolve(report); response.writeHead(204).end();
    } catch (error) { state.report?.reject(error); response.writeHead(400).end(); }
  });
  // A deny-only proxy: the app's Chromium network stack has no internet route
  // through this fixture. No update check/download is requested by the page.
  server.on('connect', (_request, socket) => socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  state.origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await fs.mkdir(profile, { recursive: true });
    await fs.writeFile(path.join(profile, 'instance-url.json'), JSON.stringify({ url: state.origin }));
    await fs.writeFile(path.join(profile, 'language.json'), '{"language":"auto"}');
    const old = await install(oldFile, evidence);
    if (old.identity.version !== '1.16.8') throw new Error('Wrong installed baseline version');
    const baselineFeed = await fs.readFile(path.join(old.resources, 'app-update.yml'), 'utf8');
    const cache = /^(?:updaterCacheDirName):\s*['"]?(@backspacedesktop-updater)['"]?\s*$/m;
    if (!cache.test(baselineFeed)) throw new Error('Unexpected baseline updater cache identity');
    state.enableStartup = process.platform !== 'linux';
    state.startup = process.platform === 'linux' ? undefined : true;
    const results = [await launchAndVerify(old, 'seed', '1.16.8', state, evidence)];
    verifyWindowsRegistrations(old, false, true);
    await verifyEncryptedCookie(profile);
    state.enableStartup = false;
    const linuxEntry = path.join(appData, 'autostart/backspace-fork.desktop');
    if (process.platform === 'linux') {
      // 1.16.8's Electron API was a Linux no-op. Simulate a real OS-owned
      // enabled legacy entry to exercise the candidate's path-refresh owner.
      await fs.mkdir(path.dirname(linuxEntry), { recursive: true });
      if (await exists(linuxEntry)) throw new Error('Unexpected Linux startup entry');
      await fs.writeFile(linuxEntry, `[Desktop Entry]\nType=Application\nName=Backspace Fork\nExec="${old.executable}" --hidden\n`);
      await fs.writeFile(path.join(profile, 'auto-launch.json'), '{"openAtLogin":true,"startMinimized":true}');
    }
    const current = await install(candidate, evidence, old.identity);
    if (current.identity.version !== version || !cache.test(await fs.readFile(path.join(current.resources, 'app-update.yml'), 'utf8'))) throw new Error('Candidate version/cache mismatch');
    state.startup = true;
    for (const phase of ['upgrade', 'repeat']) {
      if (phase === 'repeat') {
        state.startup = false;
        if (process.platform === 'win32') {
          powershell(`$key='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'; New-Item $key -Force | Out-Null; New-ItemProperty $key -Name 'Backspace Fork' -PropertyType Binary -Value ([byte[]](3,0,0,0,0,0,0,0,0,0,0,0)) -Force | Out-Null`);
        } else if (process.platform === 'linux') {
          const entry = await fs.readFile(linuxEntry, 'utf8');
          if (!entry.includes(`Exec="${current.executable}" --hidden`)) throw new Error('Enabled Linux entry did not refresh to the installed path');
          await fs.writeFile(linuxEntry, 'Hidden=true\n' + entry);
        } else {
          // On macOS use the real ServiceManagement bridge to disable the item;
          // repeat then proves startup does not reapply the stale disk setting.
          state.disableStartup = true;
          results.push(await launchAndVerify(current, 'disable', version, state, evidence));
          state.disableStartup = false;
        }
      }
      results.push(await launchAndVerify(current, phase, version, state, evidence));
      verifyWindowsRegistrations(current, true, state.startup);
      await verifyEncryptedCookie(profile);
      if (JSON.parse(await fs.readFile(path.join(profile, 'instance-url.json'))).url !== state.origin
        || JSON.parse(await fs.readFile(path.join(profile, 'language.json'))).language !== 'auto'
        || await exists(path.join(appData, 'Veyvox'))) throw new Error('Candidate changed profile/preferences identity');
    }
    if (process.platform === 'linux') {
      const [suffix, digest] = APPIMAGES[process.arch];
      const name = `Backspace-Fork-1.16.8-${suffix}`;
      run('gh', ['release', 'download', 'v1.16.8', '--repo', 'bernardokcosta/backspace', '--pattern', name, '--dir', evidence]);
      const oldImage = path.join(evidence, name), newImage = path.resolve(values.directory, `Veyvox-${version}-${suffix}`);
      if (createHash('sha256').update(await fs.readFile(oldImage)).digest('hex') !== digest) throw new Error('Historical AppImage SHA-256 mismatch');
      for (const file of [oldImage, newImage]) await fs.chmod(file, 0o755);
      state.startup = undefined; // Old Linux has no working login-item getter.
      results.push(await launchAndVerify({ executable: oldImage, env: { APPIMAGE_EXTRACT_AND_RUN: '1' } }, 'appimage-seed', '1.16.8', state, evidence));
      for (const phase of ['appimage-upgrade', 'appimage-repeat']) {
        state.startup = false;
        results.push(await launchAndVerify({ executable: newImage, env: { APPIMAGE_EXTRACT_AND_RUN: '1' } }, phase, version, state, evidence));
        await verifyEncryptedCookie(profile);
      }
      if (!(await fs.readFile(linuxEntry, 'utf8')).startsWith('Hidden=true\n')) throw new Error('Disabled Linux entry was re-enabled');
    }
    const report = { status: 'passed', platform: process.platform, arch: process.arch, baselineSha256: baseline[1],
      baseline: old.identity, candidate: current.identity, encryptedCookie: true, results,
      limitations: ['Synthetic session only; not a live user login. Startup preferences/command arguments are checked, not a real reboot/login or OS-window visibility. Renderer document visibility is metadata only.', 'Linux baseline enabled autostart entry is seeded at the OS file boundary; Electron 1.16.8 did not implement that write.'] };
    await fs.writeFile(path.resolve(values.directory, `installed-${process.platform}-${process.arch}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: 'passed', evidence, platform: process.platform, arch: process.arch }));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  verifyInstalledRebrand(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
