/* global window, document, VideoFrame, MediaStream, MediaStreamTrackGenerator */
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
    if (typeof MediaStreamTrackGenerator !== 'function') throw new Error('Window video track generator is unavailable');
    generator = new MediaStreamTrackGenerator({ kind: 'video' });
    writer = generator.writable.getWriter();
    preview.srcObject = new MediaStream([generator]);
    const playback = preview.play();
    const readiness = (async () => {
      const ready = await window.sdrSmoke.ready();
      if (ready.mode !== 'capture') return ready;
      if (typeof window.backspace?.startSdrCapture !== 'function') throw new Error('Production SDR preload bridge is absent');
      const capability = await window.backspace.getSdrCaptureCapability();
      if (!capability.supported) throw new Error(`Production SDR capability denied: ${capability.reason}`);
      const started = await window.backspace.startSdrCapture({ width: 60, height: 30, frameRate: 30 });
      await window.sdrSmoke.sessionStarted(started.sessionId);
      return { ...ready, ...started };
    })();
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
    await readiness;
  } catch (error) {
    await report({ status: 'failed', error: error.message });
  }
})();
