const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { initializeUserData } = require('../../dist/userDataMigration.js');
const { normalizeDeepLink } = require('../../dist/deepLinks.js');
const { registerLanguageIpc } = require('../../dist/languageIpc.js');

const directory = process.env.VEYVOX_SMOKE_DIR;
const phase = process.env.VEYVOX_SMOKE_PHASE;
const origin = process.env.VEYVOX_SMOKE_ORIGIN;
if (!directory || !['seed', 'migrate', 'repeat'].includes(phase) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Invalid fixture environment');
const appData = path.join(directory, 'appData');
const historical = path.join(appData, '@backspace', 'desktop');
const current = path.join(appData, 'Backspace Fork');
const sideEffects = { protocolRegistrations: 0, loginItemWrites: 0, externalRequests: 0 };
app.setAsDefaultProtocolClient = () => { sideEffects.protocolRegistrations++; throw new Error('Fixture refuses OS protocol changes'); };
app.setLoginItemSettings = () => { sideEffects.loginItemWrites++; throw new Error('Fixture refuses OS login-item changes'); };
app.setPath('appData', appData);
if (phase === 'seed') app.setName('Backspace Fork');
else {
  const result = initializeUserData(app);
  assert.equal(result.kind, phase === 'migrate' ? 'migrated' : 'no-op');
}
app.setPath('userData', phase === 'seed' ? historical : current);
const profile = app.getPath('userData');
assert.ok(profile.startsWith(appData + path.sep));
let finished = false, mainWindow;
function finish(error, result) {
  if (finished) return;
  finished = true;
  const report = error ? { status: 'failed', phase, error: String(error.message ?? error).slice(0, 500) } : { status: 'passed', phase, ...result };
  fs.writeFileSync(path.join(directory, `${phase}.json`), JSON.stringify(report, null, 2));
  app.exit(error ? 1 : 0);
}
process.on('uncaughtException', error => finish(error));
process.on('unhandledRejection', error => finish(error));
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith(origin + '/') || details.url.startsWith('devtools:');
    if (!allowed) sideEffects.externalRequests++;
    callback({ cancel: !allowed });
  });
  const createWindow = () => new BrowserWindow({ show: false, skipTaskbar: true, width: 900, height: 600,
    webPreferences: { preload: process.env.VEYVOX_SMOKE_PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  mainWindow = createWindow();
  const painted = new Promise(resolve => mainWindow.once('ready-to-show', resolve));
  // capturePage needs a compositor surface on Windows; display only this
  // controlled fixture window, without focusing it or capturing the desktop.
  mainWindow.showInactive();
  const foreignWindow = createWindow();
  const allowed = event => event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame;
  registerLanguageIpc(ipcMain, allowed, () => {});
  ipcMain.handle('get-version', event => { if (!allowed(event)) throw new Error('Foreign version query'); return app.getVersion(); });
  const reports = new Map();
  ipcMain.on('rebrand-fixture-report', async (event, report) => {
    if (![mainWindow.webContents, foreignWindow.webContents].includes(event.sender) || !report || typeof report !== 'object') return;
    try {
      assert.equal(report.ok, true, report.error);
      const name = event.sender === mainWindow.webContents ? 'main' : 'foreign';
      reports.set(name, report);
      if (reports.size !== 2) return;
      assert.equal(reports.get('foreign').denied, true);
      const result = reports.get('main');
      assert.equal(result.token, 'synthetic-session');
      assert.equal(result.language, 'auto');
      assert.equal(result.pending, 'synthetic-pending');
      assert.equal(result.cookie, 'synthetic-session');
      assert.equal(result.hasCanonical, true); assert.equal(result.hasLegacy, true);
      assert.equal(result.deepLinkCleanup, true);
      assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'instance-url.json'))).url, origin);
      assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'language.json'))).language, 'auto');
      assert.deepEqual(sideEffects, { protocolRegistrations: 0, loginItemWrites: 0, externalRequests: 0 });
      assert.equal(normalizeDeepLink('veyvox://join/fixture'), 'backspace://join/fixture');
      await session.defaultSession.cookies.flushStore();
      session.defaultSession.flushStorageData();
      await painted;
      await fs.promises.writeFile(path.join(directory, `${phase}.png`), (await mainWindow.webContents.capturePage()).toPNG());
      finish(null, { tokenPreserved: true, cookiePreserved: true, indexedDbPreserved: true, languagePreference: 'auto', instancePreserved: true, foreignFrameDenied: true, deepLinkCleanup: true, sideEffects });
    } catch (error) { finish(error); }
  });
  await Promise.all([mainWindow.loadURL(origin + '/fixture?phase=' + phase), foreignWindow.loadURL(origin + '/foreign')]);
}).catch(error => finish(error));
