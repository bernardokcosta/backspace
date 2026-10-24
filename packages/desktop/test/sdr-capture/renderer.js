/* global window, document, VideoFrame, MediaStream, MediaStreamTrackGenerator */
(async () => {
  let generator;
  let writer;
  const preview = document.getElementById('preview');
  const report = async (result) => {
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
    const readiness = window.sdrSmoke.ready();
    const onFrame = async (event) => {
      const ready = await readiness;
      if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== 'backspace-sdr-frame' || event.data.sessionId !== ready.sessionId) return;
      window.removeEventListener('message', onFrame);
      const frame = event.data.frame;
      try {
        if (!(frame instanceof VideoFrame)) throw new Error('Received frame is not a native transferable VideoFrame');
        if (frame.displayWidth !== 60 || frame.displayHeight !== 30) throw new Error('Wrong shared texture size');
        await writer.write(frame);
        frame.close();
        await playback;
        const canvas = document.getElementById('sample');
        const context = canvas.getContext('2d', { colorSpace: 'srgb' });
        context.drawImage(preview, 0, 0);
        const levels = [10, 30, 50].map((x) => [...context.getImageData(x, 15, 1, 1).data]);
        for (let i = 0; i < 3; i++) {
          const expected = [0, 118, 255][i];
          if (levels[i].slice(0, 3).some((value) => Math.abs(value - expected) > 4)) throw new Error(`Shared video pixels differ at ${i}: ${levels[i]}`);
        }
        await report({ status: 'passed', sandboxed: true, contextIsolated: true, generatorFrames: 1, videoPixels: levels });
      } catch (error) {
        frame?.close();
        await report({ status: 'failed', error: error.message });
      }
    };
    window.addEventListener('message', onFrame);
  } catch (error) {
    await report({ status: 'failed', error: error.message });
  }
})();
