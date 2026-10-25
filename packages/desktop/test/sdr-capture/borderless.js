/* global window, navigator */
let raw;
window.startBorderlessRaw = async (audio) => {
  try {
    raw = await navigator.mediaDevices.getDisplayMedia({ video: true, audio });
    return { video: raw.getVideoTracks().length, audio: raw.getAudioTracks().length };
  } catch (error) { return { failure: String(error), name: error?.name }; }
};
window.stopBorderlessRawVideo = () => {
  for (const track of raw?.getVideoTracks() ?? []) track.stop();
  return raw?.getVideoTracks().every((track) => track.readyState === 'ended') ?? true;
};
window.stopBorderlessRaw = () => { for (const track of raw?.getTracks() ?? []) track.stop(); raw = null; };
