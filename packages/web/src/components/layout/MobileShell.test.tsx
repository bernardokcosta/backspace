import { describe, it, expect, vi } from 'vitest';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: vi.fn(() => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() })) } }));
import { mobileScreenMap } from './MobileShell';

describe('MobileShell retained screens', () => {
  it('does not register the removed hub screen', () => {
    expect(mobileScreenMap).not.toHaveProperty('backspace');
  });
  it.each(['friends', 'channel-chat', 'settings', 'settings-desktop', 'settings-instance-updates'])('keeps %s', (screen) => {
    expect(mobileScreenMap[screen]).toBeTypeOf('function');
  });
});
