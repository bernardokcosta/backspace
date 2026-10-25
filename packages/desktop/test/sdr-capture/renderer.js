/* global window, document, VideoFrame, MediaStream, MediaStreamTrackGenerator */
async function runProductionAdapterSmoke() {
  const adapter = await import('/utils/sdrScreenCapture.js');
  const capability = await adapter.getSdrCaptureCapability();
  if (!capability.supported) throw new Error(`Production SDR capability denied: ${capability.reason}`);
  const canvas = document.getElementById('sample');
  const raw = canvas.captureStream(1); // Synthetic raw source; no microphone or other window.
  const sessionPacket = (event) => {
    if (event.source === window && event.origin === window.location.origin && event.data?.type === 'backspace-sdr-frame') {
      void window.sdrSmoke.sessionStarted(event.data.sessionId);
    }
  };
  window.addEventListener('message', sessionPacket);
  const stream = await adapter.acquireSdrScreenCapture(raw, { width: 60, height: 30, frameRate: 30 });
  console.log('[adapter-smoke] corrected first-frame handoff', JSON.stringify(stream.getVideoTracks()[0].getSettings()));
  window.removeEventListener('message', sessionPacket);
  if (raw.getVideoTracks()[0].readyState !== 'ended') throw new Error('Raw video survived the corrected handoff');
  const preview = document.getElementById('preview');
  preview.srcObject = stream;
  await preview.play();
  console.log('[adapter-smoke] playback started', preview.videoWidth, preview.videoHeight);
  async function sample(width, height) {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (attempt === 0) console.log('[adapter-smoke] video state', preview.videoWidth, preview.videoHeight, 'expected', width, height);
      // A static source may have presented its sole frame before play()
      // resolved. Sample that real frame instead of requiring a second one.
      if (preview.readyState < 2 || preview.videoWidth !== width || preview.videoHeight !== height) {
        // Occlusion/static presentation can suppress rVFC even after videoWidth
        // and decoded pixels have advanced. Poll actual decoded video state;
        // dimensions and pixel samples below are still mandatory, not skipped.
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
      context.drawImage(preview, 0, 0);
      const levels = [1, 3, 5].map((position) => [...context.getImageData(Math.floor(width * position / 6), Math.floor(height / 2), 1, 1).data]);
      for (let i = 0; i < 3; i++) {
        if (levels[i].slice(0, 3).some((value) => Math.abs(value - [0, 118, 255][i]) > 4)) throw new Error(`Production adapter pixels differ: ${levels[i]}`);
      }
      return levels;
    }
    throw new Error(`Production adapter never delivered ${width}x${height}`);
  }
  await sample(60, 30);
  await window.sdrSmoke.resizeSource();
  if (!await adapter.configureSdrScreenCapture(stream, { width: 90, height: 45, frameRate: 30 })) throw new Error('Production adapter lost stream ownership');
  const levels = await sample(90, 45);
  await window.sdrSmoke.report({ status: 'passed', sandboxed: true, contextIsolated: true, productionWebAdapter: true, sizes: ['60x30', '90x45'], videoPixels: levels });
}

(async () => {
  let generator;
  let writer;
  let busy = false;
  let finished = false;
  let generatorFrames = 0;
  const sizes = new Set();
  const preview = document.getElementById('preview');
  const report = async (result) => {
    if (finished) return;
    finished = true;
    if (writer) { try { await writer.close(); } catch { /* Track may already be closed. */ } }
    generator?.stop();
    preview.srcObject = null;
    await window.sdrSmoke.report(result);
  };
  try {
    if (window.require !== undefined || window.process !== undefined) throw new Error('Renderer Node isolation was lost');
    if (!window.sdrSmoke.security.sandboxed || !window.sdrSmoke.security.contextIsolated) throw new Error('Preload security flags were lost');
    const ready = await window.sdrSmoke.ready();
    if (ready.mode === 'capture') { await runProductionAdapterSmoke(); return; }
    if (typeof MediaStreamTrackGenerator !== 'function') throw new Error('Window video track generator is unavailable');
    generator = new MediaStreamTrackGenerator({ kind: 'video' });
    writer = generator.writable.getWriter();
    preview.srcObject = new MediaStream([generator]);
    const playback = preview.play();
    const readiness = Promise.resolve(ready);
    const onFrame = async (event) => {
      const ready = await readiness;
      if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== 'backspace-sdr-frame' || event.data.sessionId !== ready.sessionId) return;
      const frame = event.data.frame;
      if (busy || finished) { frame?.close(); return; }
      busy = true;
      try {
        if (!(frame instanceof VideoFrame)) throw new Error('Received frame is not a native transferable VideoFrame');
        const width = frame.displayWidth;
        const height = frame.displayHeight;
        if (!((width === 60 && height === 30) || (ready.mode === 'capture' && width === 90 && height === 45))) throw new Error(`Wrong shared texture size: ${width}x${height}`);
        const rendered = new Promise((resolve) => preview.requestVideoFrameCallback(resolve));
        await writer.write(frame);
        frame.close();
        await playback;
        await rendered;
        const canvas = document.getElementById('sample');
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
        context.drawImage(preview, 0, 0);
        const levels = [1, 3, 5].map((position) => [...context.getImageData(Math.floor(width * position / 6), Math.floor(height / 2), 1, 1).data]);
        for (let i = 0; i < 3; i++) {
          const expected = [0, 118, 255][i];
          if (levels[i].slice(0, 3).some((value) => Math.abs(value - expected) > 4)) throw new Error(`Shared video pixels differ at ${i}: ${levels[i]}`);
        }
        generatorFrames++;
        sizes.add(`${width}x${height}`);
        if (ready.mode !== 'capture' || (sizes.has('60x30') && sizes.has('90x45'))) {
          await report({ status: 'passed', sandboxed: true, contextIsolated: true, generatorFrames, sizes: [...sizes], videoPixels: levels });
        }
      } catch (error) {
        frame?.close();
        await report({ status: 'failed', error: error.message });
      } finally { busy = false; }
    };
    window.addEventListener('message', onFrame);
    await window.sdrSmoke.beginSynthetic();
    await readiness;
  } catch (error) {
    await report({ status: 'failed', error: error.message });
  }
})();
