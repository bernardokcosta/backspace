import { describe, it, expect, vi } from 'vitest';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: vi.fn(() => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() })) } }));
import { mobileScreenMap } from './MobileShell';

describe('MobileShell retained screens', () => {
  it.each(['backspace', 'explore'])('does not register the removed %s screen', (screen) => {
    expect(mobileScreenMap).not.toHaveProperty(screen);
  });
  it.each(['friends', 'channel-chat', 'settings', 'settings-desktop', 'settings-instance-updates'])('keeps %s', (screen) => {
    expect(mobileScreenMap[screen]).toBeTypeOf('function');
  });
});
