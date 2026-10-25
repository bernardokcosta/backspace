const { app, BrowserWindow, ipcMain, sharedTexture } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { createSdrCaptureTransport } = require('../../dist/sdrCaptureTransport.js');
const { createSdrCaptureController, registerSdrCaptureIpc, resolveNativeSdrSource } = require('../../dist/sdrCapture.js');

const evidence = process.env.BACKSPACE_SDR_SMOKE_DIR;
if (!evidence || !process.env.BACKSPACE_SDR_NATIVE) throw new Error('Use the isolated SDR smoke runner');
const stage = (message) => fs.appendFileSync(path.join(evidence, 'stages.log'), `${message}\n`);
stage('fixture initialized');
app.setName('Backspace SDR Capture Test');
stage('test app name set');
const profile = path.join(evidence, 'profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
stage('isolated profile configured');
const mode = process.env.BACKSPACE_SDR_SMOKE_MODE;
const native = mode === 'baseline' ? null : require(process.env.BACKSPACE_SDR_NATIVE);
stage(native ? 'native module loaded' : 'Electron baseline without native module');
const sessionId = '8dfd1bcd-7b0d-4a1c-9031-40d830256b67';
let window;
let sourceWindow;
let captureId;
let server;
let finished = false;
let timer;
let navigationComplete;
const forwardedSessions = new Set();
const endedSessions = [];

function finish(result) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  controller.invalidate('shutdown');
  if (sourceWindow && !sourceWindow.isDestroyed()) sourceWindow.destroy();
  if (window && !window.isDestroyed()) window.destroy();
  server?.close();
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  // Quit through Electron's lifecycle instead of terminating from inside its
  // ready/IPC callback while native and browser initialization is unwinding.
  setImmediate(() => app.quit());
}

const transport = createSdrCaptureTransport({
  api: sharedTexture,
  isTargetAllowed: (frame) => window && !window.isDestroyed() && frame === window.webContents.mainFrame,
  releaseFrame: (id) => native.releaseFrame(id),
});
let resized = false;
const controller = createSdrCaptureController({
  platform: process.platform, systemVersion: process.getSystemVersion(), transportAvailable: true,
  loadModule: () => native,
  isTargetAllowed: (frame) => window && !window.isDestroyed() && frame === window.webContents.mainFrame,
  isFocused: () => window?.isFocused() ?? false,
  now: () => Date.now(),
  sendFrame: async (owner, id, frame) => {
    await transport.sendSdrFrame(owner, id, frame);
    if (!forwardedSessions.has(id)) stage(`first production frame: ${frame.width}x${frame.height}`);
    forwardedSessions.add(id);
    if (!resized && !finished && captureId) {
      stage('requesting source resize and native configure');
      resized = true;
      sourceWindow.setContentSize(400, 200);
      controller.configure(owner, id, { width: 90, height: 45, frameRate: 30 });
    }
  },
  onEnded: (owner, ended) => {
    endedSessions.push(ended);
    stage(`production capture ended: ${ended.reason}`);
    if (!owner.isDestroyed()) owner.send('sdr-capture-ended', ended);
    if (!finished && !['stopped', 'navigation', 'shutdown', 'renderer-gone'].includes(ended.reason)) {
      finish({ status: 'failed', error: `Production controller: ${ended.reason}` });
    }
  },
});
registerSdrCaptureIpc(ipcMain, controller, (event) => event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame);
// Capture id is recorded only to drive the test's configured-size transition.
ipcMain.handle('sdr-smoke-session', (event, id) => {
  assert.equal(event.senderFrame, window.webContents.mainFrame);
  captureId = id;
});

ipcMain.handle('sdr-smoke-ready', async (event) => {
  stage('renderer ready');
  assert.equal(event.sender, window.webContents);
  assert.equal(event.senderFrame, window.webContents.mainFrame);
  if (mode === 'capture') {
    assert.equal(native.isCaptureSupported(), true, 'Windows Graphics Capture is unsupported on this host');
    const source = resolveNativeSdrSource({ id: `window:${sourceWindow.getNativeWindowHandle().readBigUInt64LE()}:0`, display_id: '' }, []);
    assert.ok(source);
    assert.equal(controller.grant(event.senderFrame, source), true);
    return { sessionId, mode };
  }
  setImmediate(async () => {
    try {
      const width = 60;
      const height = 30;
      const pixels = new Float32Array(width * height * 4);
      const levels = [0, 0.18, 1];
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const value = levels[Math.floor(x / 20)];
        pixels.set([value, value, value, 1], offset);
      }
      const held = [0, 1, 2].map(() => native.createTestFrame(pixels, width, height, 80, 80));
      assert.equal(native.retainedFrameCount(), 3);
      assert.throws(() => native.createTestFrame(pixels, width, height, 80, 80), /capacity/);
      native.releaseFrame(held[0].frameId);
      const replacement = native.createTestFrame(pixels, width, height, 80, 80);
      assert.notEqual(replacement.frameId, held[0].frameId);
      for (const retained of [...held.slice(1), replacement]) native.releaseFrame(retained.frameId);
      assert.equal(native.retainedFrameCount(), 0);
      const frame = native.createTestFrame(pixels, width, height, 80, 80);
      stage('synthetic GPU texture created');
      await transport.sendSdrFrame(window.webContents.mainFrame, sessionId, frame);
      stage('synthetic texture transferred');
    } catch (error) {
      finish({ status: 'failed', error: error.message });
    }
  });
  return { sessionId, mode };
});

async function captureLifecycleChecks() {
  const source = { kind: 'window', id: `window:${sourceWindow.getNativeWindowHandle().readBigUInt64LE()}:0` };
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = native.startCapture(source, { width: 60, height: 30, frameRate: 30 }, (frame) => native.releaseFrame(frame.frameId), () => {});
    native.stopCapture(id);
    native.stopCapture(id);
  }
  stage('100 immediate cancel/repeated-stop checks completed');
  async function expectEnd(reason, callback, action) {
    let timeout;
    try {
      await new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`Native ${reason} test timed out`)), 8000);
        native.startCapture(source, { width: 60, height: 30, frameRate: 30 }, callback, (actual) => {
          stage(`lifecycle ended ${actual}; retained ${native.retainedFrameCount()}`);
          try { assert.equal(actual, reason); resolve(); } catch (error) { reject(error); }
        });
        action?.();
      });
    } finally { clearTimeout(timeout); }
  }
  await expectEnd('callback-failed', (frame) => {
    stage('intentional frame callback failure');
    native.releaseFrame(frame.frameId);
    throw new Error('Intentional controlled callback failure');
  });
  await expectEnd('source-closed', (frame) => {
    stage('closing controlled source after captured frame');
    native.releaseFrame(frame.frameId);
    if (!sourceWindow.isDestroyed()) sourceWindow.destroy();
  });
  return { immediateCancelRestarts: 100, repeatedStop: true, callbackExceptionStopped: true, sourceClosureStopped: true };
}

async function waitFor(check, description, duration = 5000) {
  const deadline = Date.now() + duration;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

ipcMain.handle('sdr-smoke-report', async (event, result) => {
  try {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) return;
    if (result.status !== 'passed') { finish(result); return; }
    // A very fast synthetic frame can finish before loadURL resolves. Closing
    // the window first would abort that navigation and mask a passing result.
    await navigationComplete;
    const preferences = window.webContents.getLastWebPreferences();
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.nodeIntegration, false);
    let hostLifecycle;
    if (mode === 'capture') {
      const initialId = captureId;
      await window.loadURL('about:blank');
      assert.ok(endedSessions.some((ended) => ended.sessionId === initialId && ended.reason === 'navigation'));
      await waitFor(() => native.retainedFrameCount() === 0, 'navigation GPU cleanup');
      const source = resolveNativeSdrSource({ id: `window:${sourceWindow.getNativeWindowHandle().readBigUInt64LE()}:0`, display_id: '' }, []);
      assert.equal(controller.grant(window.webContents.mainFrame, source), true);
      const second = controller.start(window.webContents.mainFrame, { width: 60, height: 30, frameRate: 30 });
      captureId = second.sessionId;
      await waitFor(() => forwardedSessions.has(second.sessionId), 'a real frame before renderer destruction');
      window.destroy();
      await waitFor(() => endedSessions.some((ended) => ended.sessionId === second.sessionId && ended.reason === 'renderer-gone'), 'renderer destruction teardown');
      captureId = null;
      hostLifecycle = { navigationStopped: true, activeRendererDestructionStopped: true, productionPreload: true };
    } else window.destroy();
    await waitFor(() => native.retainedFrameCount() === 0, 'renderer GPU cleanup');
    const lifecycle = mode === 'capture' ? await captureLifecycleChecks() : undefined;
    assert.equal(native.retainedFrameCount(), 0);
    finish({ ...result, status: 'passed', mode, hostLifecycle, lifecycle, retainedFrames: 0, arch: process.arch, electron: process.versions.electron, gpu: app.getGPUFeatureStatus() });
  } catch (error) { finish({ status: 'failed', error: error.message }); }
});

app.whenReady().then(async () => {
  stage('app ready');
  if (mode === 'baseline') {
    finish({ status: 'passed', mode: 'electron-baseline', nativeLoaded: false, arch: process.arch, electron: process.versions.electron, gpuTransport: 'not-tested' });
    return;
  }
  if (mode === 'module') {
    assert.equal(native.retainedFrameCount(), 0);
    assert.throws(() => native.createTestFrame(new Float32Array(4), 0, 1, 80, 80), /dimensions/);
    native.releaseFrame('already-released');
    assert.equal(typeof native.startCapture, 'function');
    assert.equal(typeof native.configureCapture, 'function');
    assert.equal(typeof native.stopCapture, 'function');
    assert.throws(() => native.startCapture({ kind: 'window', id: 'window:0:0' }, { width: 0, height: 0, frameRate: 60 }, () => {}, () => {}), /source/);
    native.stopCapture('already-stopped');
    assert.equal(native.retainedFrameCount(), 0);
    finish({ status: 'passed', mode: 'module-load-only', nativeLoaded: true, arch: process.arch, electron: process.versions.electron, gpuTransport: 'not-tested' });
    return;
  }
  const files = new Map([
    ['/', { file: 'renderer.html', type: 'text/html' }],
    ['/renderer.js', { file: 'renderer.js', type: 'text/javascript' }],
    ['/source.html', { file: 'source.html', type: 'text/html' }],
    ['/source.css', { file: 'source.css', type: 'text/css' }],
    ['/source.js', { file: 'source.js', type: 'text/javascript' }],
  ]);
  server = http.createServer((request, response) => {
    const asset = files.get(request.url);
    if (!asset) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, {
      'Content-Type': asset.type,
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; media-src blob:; connect-src 'none'",
      'Cache-Control': 'no-store',
    });
    response.end(fs.readFileSync(path.join(__dirname, asset.file)));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  if (mode === 'capture') {
    sourceWindow = new BrowserWindow({ width: 320, height: 160, useContentSize: true, frame: false, hasShadow: false, show: false, skipTaskbar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await sourceWindow.loadURL(`http://127.0.0.1:${server.address().port}/source.html`);
    sourceWindow.showInactive();
    stage('controlled source window created; no other source may be captured');
  }
  window = new BrowserWindow({
    show: mode === 'capture',
    webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, preload: mode === 'capture' ? process.env.BACKSPACE_SDR_PRELOAD : path.join(__dirname, 'preload.cjs'),
    },
  });
  stage('sandboxed window created');
  window.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) controller.invalidate('navigation');
  });
  window.webContents.on('destroyed', () => controller.invalidate('renderer-gone'));
  if (mode === 'capture') window.focus();
  window.webContents.on('console-message', (details) => stage(`renderer console: ${details.message}`));
  window.webContents.on('render-process-gone', (_event, details) => finish({ status: 'failed', error: `Renderer lost: ${details.reason}` }));
  timer = setTimeout(() => finish({ status: 'failed', error: 'No renderer frame result within 30 seconds' }), 30000);
  navigationComplete = window.loadURL(`http://127.0.0.1:${server.address().port}/`);
  await navigationComplete;
}).catch((error) => finish({ status: 'failed', error: error.message }));

app.on('window-all-closed', () => {});
app.on('before-quit', () => stage('before-quit'));
app.on('will-quit', () => stage('will-quit'));
process.on('exit', (code) => stage(`Node exit ${code}`));
