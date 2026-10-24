/* global window */
const { contextBridge, ipcRenderer, sharedTexture } = require('electron');

sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }, metadata) => {
  let frame;
  try {
    frame = importedSharedTexture.getVideoFrame();
    window.postMessage({ type: 'backspace-sdr-frame', sessionId: metadata.sessionId, frame }, window.location.origin, [frame]);
    frame = null; // Ownership transferred to the main world.
  } finally {
    frame?.close();
    importedSharedTexture.release();
  }
});

contextBridge.exposeInMainWorld('sdrSmoke', {
  ready: () => ipcRenderer.invoke('sdr-smoke-ready'),
  report: (result) => ipcRenderer.invoke('sdr-smoke-report', result),
  security: { sandboxed: process.sandboxed, contextIsolated: process.contextIsolated },
});
