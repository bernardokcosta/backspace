// Appended to the compiled production preload in the isolated temp directory.
// It adds test readiness/reporting only; frame transport remains production code.
{
  const { contextBridge, ipcRenderer } = require('electron');
  contextBridge.exposeInMainWorld('sdrSmoke', {
    ready: () => ipcRenderer.invoke('sdr-smoke-ready'),
    report: (result) => ipcRenderer.invoke('sdr-smoke-report', result),
    sessionStarted: (id) => ipcRenderer.invoke('sdr-smoke-session', id),
    resizeSource: () => ipcRenderer.invoke('sdr-smoke-resize'),
    security: { sandboxed: process.sandboxed, contextIsolated: process.contextIsolated },
  });
}
