const { app, BrowserWindow, ipcMain, sharedTexture } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { createSdrCaptureTransport } = require('../../dist/sdrCaptureTransport.js');

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

function finish(result) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  if (captureId) native.stopCapture(captureId);
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

ipcMain.handle('sdr-smoke-ready', async (event) => {
  stage('renderer ready');
  assert.equal(event.sender, window.webContents);
  assert.equal(event.senderFrame, window.webContents.mainFrame);
  if (mode === 'capture') {
    assert.equal(native.isCaptureSupported(), true, 'Windows Graphics Capture is unsupported on this host');
    const source = { kind: 'window', id: `window:${sourceWindow.getNativeWindowHandle().readBigUInt64LE()}:0` };
    let resized = false;
    captureId = native.startCapture(source, { width: 60, height: 30, frameRate: 30 }, (frame) => {
      if (finished) { native.releaseFrame(frame.frameId); return; }
      transport.sendSdrFrame(window.webContents.mainFrame, sessionId, frame).then(() => {
        if (!resized && !finished && captureId) {
          resized = true;
          sourceWindow.setContentSize(400, 200);
          native.configureCapture(captureId, { width: 90, height: 45, frameRate: 30 });
        }
      }).catch((error) => finish({ status: 'failed', error: error.message }));
    }, (reason) => finish({ status: 'failed', error: `Native WGC: ${reason}` }));
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

ipcMain.handle('sdr-smoke-report', async (event, result) => {
  if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) return;
  if (result.status !== 'passed') { finish(result); return; }
  // A very fast synthetic frame can finish before loadURL resolves. Closing
  // the window first would abort that navigation and mask a passing result.
  await navigationComplete;
  if (captureId) { native.stopCapture(captureId); captureId = null; }
  const preferences = window.webContents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  window.destroy();
  const deadline = Date.now() + 5000;
  const wait = async () => {
    const retainedFrames = native.retainedFrameCount();
    if (retainedFrames === 0) {
      try {
        const lifecycle = mode === 'capture' ? await captureLifecycleChecks() : undefined;
        assert.equal(native.retainedFrameCount(), 0);
        finish({ ...result, status: 'passed', mode, lifecycle, retainedFrames, arch: process.arch, electron: process.versions.electron, gpu: app.getGPUFeatureStatus() });
      } catch (error) { finish({ status: 'failed', error: error.message }); }
    } else if (Date.now() >= deadline) {
      finish({ status: 'failed', error: `Native frames retained after renderer close: ${retainedFrames}` });
    } else setTimeout(wait, 25);
  };
  setTimeout(wait, 25);
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
    show: false,
    webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  stage('sandboxed window created');
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
