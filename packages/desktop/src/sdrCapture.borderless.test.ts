import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebFrameMain } from 'electron';
import { createSdrCaptureController } from './sdrCapture';
import type { NativeBorderlessAccessResult, NativeSdrModule, NativeSdrSource } from './sdrCaptureTypes';

const source: NativeSdrSource = { kind: 'window', id: 'window:123:0' };
const constraints = { width: 640, height: 360, frameRate: 30 };
function setup() {
  const owner = { isDestroyed: () => false } as WebFrameMain;
  const replies = new Map<string, (result: NativeBorderlessAccessResult) => void>();
  const native: NativeSdrModule = {
    isCaptureSupported: vi.fn(() => true),
    requestBorderlessAccess: vi.fn((id, reply) => { replies.set(id, reply); }),
    cancelBorderlessAccess: vi.fn(), startCapture: vi.fn(() => 'native'),
    configureCapture: vi.fn(), stopCapture: vi.fn(), releaseFrame: vi.fn(),
  };
  let now = 0; let focused = true;
  const controller = createSdrCaptureController({ platform: 'win32', systemVersion: '10.0.26100',
    transportAvailable: true, loadModule: () => native, sendFrame: vi.fn(async () => {}),
    onEnded: vi.fn(), isTargetAllowed: (frame) => frame === owner && !frame.isDestroyed(),
    isFocused: () => focused, now: () => now });
  const answer = (status: NativeBorderlessAccessResult['status'], index = replies.size - 1) => {
    const [id, reply] = [...replies][index]!; reply({ status }); return id;
  };
  return { owner, native, controller, answer, setNow: (value: number) => { now = value; }, setFocus: (value: boolean) => { focused = value; } };
}
afterEach(() => vi.useRealTimers());

describe('strict borderless capture preparation', () => {
  it.each(['denied-user', 'denied-system', 'not-declared', 'unsupported', 'failed'] as const)('blocks %s before native capture and confirmation', async (status) => {
    const s = setup(); const pending = s.controller.prepare(s.owner, source);
    expect(s.native.startCapture).not.toHaveBeenCalled();
    s.answer(status);
    expect(await pending).toEqual({ ok: false, reason: status });
    expect(s.controller.confirmSelection(s.owner, source)).toBe(false);
    expect(() => s.controller.start(s.owner, constraints)).toThrow('authorization');
  });
  it('coalesces duplicate preparations, binds the source and consumes consent only once', async () => {
    const s = setup(); const first = s.controller.prepare(s.owner, source); const second = s.controller.prepare(s.owner, source);
    expect(s.native.requestBorderlessAccess).toHaveBeenCalledOnce();
    const id = s.answer('allowed');
    expect(await first).toEqual({ ok: true }); expect(await second).toEqual({ ok: true });
    expect(() => s.controller.start(s.owner, constraints)).toThrow('authorization');
    expect(s.controller.confirmSelection(s.owner, source)).toBe(true);
    const capture = s.controller.start(s.owner, constraints);
    expect(s.native.startCapture).toHaveBeenCalledWith(source, constraints, expect.any(Function), expect.any(Function), id);
    s.controller.stop(s.owner, capture.sessionId);
    expect(s.controller.confirmSelection(s.owner, source)).toBe(false);
  });
  it.each(['cancel', 'navigation', 'focus', 'source', 'foreign', 'expired'] as const)('never arms an obsolete preparation after %s', async (event) => {
    const s = setup(); const pending = s.controller.prepare(s.owner, source);
    if (event === 'cancel') s.controller.revokeGrant();
    if (event === 'navigation') s.controller.invalidate('navigation');
    if (event === 'focus') s.setFocus(false);
    s.answer('allowed'); await pending;
    if (event === 'expired') s.setNow(30_001);
    const frame = event === 'foreign' ? {} as WebFrameMain : s.owner;
    const target = event === 'source' ? { ...source, id: 'window:456:0' } : source;
    expect(s.controller.confirmSelection(frame, target)).toBe(false);
    expect(s.native.startCapture).not.toHaveBeenCalled();
  });
  it('ignores an old allowed reply without cancelling the new selected preparation', async () => {
    const s = setup(); const old = s.controller.prepare(s.owner, source);
    const target: NativeSdrSource = { kind: 'window', id: 'window:456:0' };
    const current = s.controller.prepare(s.owner, target);
    s.answer('allowed', 0); s.answer('allowed', 1);
    expect(await old).toEqual({ ok: false, reason: 'cancelled' });
    expect(await current).toEqual({ ok: true }); expect(s.controller.confirmSelection(s.owner, target)).toBe(true);
  });
  it('times out unanswered consent independently of a frame and allows explicit retry', async () => {
    vi.useFakeTimers(); const s = setup(); const pending = s.controller.prepare(s.owner, source);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toEqual({ ok: false, reason: 'timeout' }); expect(s.native.cancelBorderlessAccess).toHaveBeenCalled();
    const retry = s.controller.prepare(s.owner, source); s.answer('allowed'); expect(await retry).toEqual({ ok: true });
    s.controller.revokeGrant();
  });
  it('does not request consent for foreign/unfocused callers or old native modules', async () => {
    const s = setup();
    expect((await s.controller.prepare({} as WebFrameMain, source)).ok).toBe(false);
    s.setFocus(false); expect((await s.controller.prepare(s.owner, source)).ok).toBe(false);
    expect(s.native.requestBorderlessAccess).not.toHaveBeenCalled();
    s.setFocus(true); delete s.native.requestBorderlessAccess;
    expect(s.controller.capability().supported).toBe(false);
  });
});
