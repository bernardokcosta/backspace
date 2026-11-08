import { describe, expect, it, vi } from 'vitest';
import { createJunoMusicPlayer } from './junoMusic';
vi.mock('./AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));

function setup() {
  const status = vi.fn();
  const media = { loop: false, preload: '', src: '', currentTime: 0, error: null as MediaError | null, play: vi.fn(async () => {}), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const gain = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const manager = { resumeContext: vi.fn(async () => {}), ensureContext: () => ({ createGain: () => gain, createMediaElementSource: () => source }) as unknown as AudioContext, getMasterOutput: () => ({}) as AudioNode };
  const createMedia = vi.fn(() => media as unknown as HTMLAudioElement);
  const player = createJunoMusicPlayer(status, { manager: () => manager, createMedia });
  return { player, media, gain, source, manager, createMedia, status };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
describe('managed Juno music stream', () => {
  it('offers gesture retry rather than hanging on a suspended pre-gesture context', async () => {
    const s = setup(); const context = s.manager.ensureContext();
    s.manager.ensureContext = () => ({ ...context, state: 'suspended' }) as AudioContext;
    s.player.update(true, .2); await flush(); expect(s.status).toHaveBeenLastCalledWith('blocked'); expect(s.manager.resumeContext).not.toHaveBeenCalled();
    s.player.retry(); await flush(); expect(s.media.play).toHaveBeenCalledOnce(); s.player.dispose();
  });
  it('recovers safely after output setup failure and never bypasses the shared bus', async () => {
    const s = setup(); s.source.connect.mockImplementationOnce(() => { throw new Error('Output unavailable'); });
    s.player.update(true, .2); await flush(); expect(s.status).toHaveBeenLastCalledWith('error'); expect(s.media.play).not.toHaveBeenCalled();
    s.player.retry(); await flush(); expect(s.source.connect).toHaveBeenCalledTimes(2); expect(s.media.play).toHaveBeenCalledOnce(); s.player.dispose();
  });
  it('does not create or download media outside the principal view', async () => {
    const s = setup(); s.player.update(false, .2); await flush(); expect(s.createMedia).not.toHaveBeenCalled(); s.player.dispose();
  });
  it('uses one stream on the existing bus, changes gain live and resumes its position', async () => {
    const s = setup(); s.player.update(true, .2); await flush();
    expect(s.media.src).toBe('/games/juno/music/charting-the-dark.mp3'); expect(s.media.loop).toBe(true);
    expect(s.gain.gain.value).toBe(.2); expect(s.status).toHaveBeenLastCalledWith('playing');
    s.media.currentTime = 42; s.player.update(true, .05); await flush();
    expect(s.media.play).toHaveBeenCalledOnce(); expect(s.gain.gain.value).toBe(.05);
    s.player.update(false, .05); expect(s.gain.gain.value).toBe(0); expect(s.media.pause).toHaveBeenCalled();
    s.player.update(true, .1); await flush(); expect(s.media.currentTime).toBe(42); expect(s.createMedia).toHaveBeenCalledOnce();
    s.player.dispose(); expect(s.source.disconnect).toHaveBeenCalledOnce(); expect(s.gain.disconnect).toHaveBeenCalledOnce(); expect(s.media.removeAttribute).toHaveBeenCalledWith('src');
  });
  it('contains autoplay refusal until an explicit eligible retry', async () => {
    const s = setup(); s.media.play.mockRejectedValueOnce(new DOMException('Gesture required', 'NotAllowedError'));
    s.player.update(true, .2); await flush(); expect(s.status).toHaveBeenLastCalledWith('blocked'); expect(s.gain.gain.value).toBe(0);
    s.player.update(true, .1); s.player.update(true, .2); await flush(); expect(s.media.play).toHaveBeenCalledOnce();
    s.player.retry(); await flush(); expect(s.media.play).toHaveBeenCalledTimes(2); expect(s.status).toHaveBeenLastCalledWith('playing');
    s.player.dispose();
  });
  it('reloads a failed media resource on gesture retry without creating another stream', async () => {
    const s = setup();
    s.media.play.mockImplementation(async () => { if (s.media.error) throw new DOMException('Source unavailable', 'NotSupportedError'); });
    s.media.error = { code: 4 } as MediaError;
    s.media.load.mockImplementation(() => { s.media.error = null; });
    s.player.update(true, .2); await flush(); expect(s.status).toHaveBeenLastCalledWith('error');
    s.player.retry(); await flush();
    expect(s.media.load).toHaveBeenCalledOnce(); expect(s.status).toHaveBeenLastCalledWith('playing');
    expect(s.createMedia).toHaveBeenCalledOnce(); expect(s.gain.gain.value).toBe(.2); s.player.dispose();
  });
  it('invalidates a pending errored play before retry and cannot unmute it after hiding', async () => {
    const s = setup(); let done!: () => void;
    s.media.play.mockReturnValueOnce(new Promise<void>(resolve => { done = resolve; }));
    s.player.update(true, .2); await flush(); s.media.error = { code: 4 } as MediaError;
    s.media.load.mockImplementation(() => { s.media.error = null; });
    s.player.retry(); s.player.update(false, .2); done(); await flush();
    expect(s.gain.gain.value).toBe(0); expect(s.media.play).toHaveBeenCalledOnce();
    s.player.update(true, .2); await flush(); expect(s.media.play).toHaveBeenCalledTimes(2);
    expect(s.createMedia).toHaveBeenCalledOnce(); s.player.dispose();
  });
  it('keeps a delayed start silent after hide/dispose and never creates parallel starts', async () => {
    const s = setup(); let done!: () => void;
    s.media.play.mockReturnValueOnce(new Promise<void>(resolve => { done = resolve; }));
    s.player.update(true, .2); await flush(); s.player.update(false, .2); s.player.update(true, .2);
    expect(s.media.play).toHaveBeenCalledOnce(); expect(s.gain.gain.value).toBe(0);
    s.player.dispose(); done(); await flush(); expect(s.gain.gain.value).toBe(0); expect(s.media.play).toHaveBeenCalledOnce();
  });
  it('does not call play if context resume finishes after leaving, and zero gain pauses', async () => {
    const s = setup(); let done!: () => void;
    s.manager.resumeContext.mockReturnValueOnce(new Promise<void>(resolve => { done = resolve; }));
    s.player.update(true, .2); s.player.update(false, .2); done(); await flush(); expect(s.media.play).not.toHaveBeenCalled();
    s.player.update(true, .2); await flush(); s.player.update(true, 0); expect(s.gain.gain.value).toBe(0); expect(s.media.pause).toHaveBeenCalled(); s.player.dispose();
  });
});
