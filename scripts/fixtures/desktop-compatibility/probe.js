/* global document, window */
const methods = ['getVersion', 'getUpdateStatus', 'getRecoveryState', 'checkForUpdates',
  'installUpdate', 'openReleasePage', 'openExternal', 'minimize', 'maximize', 'close'];
let running = false;
async function readWithinLimit(read) {
  let timeout;
  try {
    return await Promise.race([read(), new Promise((resolve) => { timeout = setTimeout(() => resolve(null), 8000); })]);
  } catch { return null; }
  finally { clearTimeout(timeout); }
}
async function run() {
  if (running) return;
  running = true;
  const status = document.getElementById('result');
  status.textContent = 'Reading only version/capability metadata…';
  try {
    const api = window.backspace;
    const version = typeof api?.getVersion === 'function' ? await readWithinLimit(() => api.getVersion()) : null;
    const snapshot = typeof api?.getUpdateStatus === 'function' ? await readWithinLimit(() => api.getUpdateStatus()) : null;
    const bridgeMethods = Object.fromEntries(methods.filter((name) => typeof api?.[name] === 'function').map((name) => [name, true]));
    const response = await fetch('/probe/report', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, platform: api?.platform, bridgeMethods, updateMode: snapshot?.capability }) });
    if (!response.ok) throw new Error('Probe refused metadata');
    const ws = new WebSocket(`${window.location.origin.replace('http:', 'ws:')}/probe/ws`);
    await new Promise((resolve, reject) => { ws.addEventListener('close', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    status.textContent = 'Sanitized HTTP/bridge and WebSocket-handshake metadata saved. This is not active-session or updater acceptance.';
  } catch { status.textContent = 'Probe failed. Inspect the isolated test environment; no credentials or error payloads were recorded.'; }
  finally { running = false; }
}
document.getElementById('repeat').addEventListener('click', () => { void run(); });
void run();
