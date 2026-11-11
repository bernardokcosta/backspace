import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordDiagnostic } from '../utils/diagnostics';
import { cleanup, renderHook } from '@testing-library/react';
import { installSocketHarness, TestWebSocket } from '../test/socketHarness';

vi.mock('../utils/diagnostics', () => ({ recordDiagnostic: vi.fn() }));

// jsdom has no AudioWorkletNode; the handler's imports reach the voice stack.
vi.mock('../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
      playSound: vi.fn(() => Promise.resolve(null)),
    }),
  },
}));
vi.mock('../hooks/useMascotAnimation', () => ({ useMascotAnimation: vi.fn() }));

const { useWebSocket } = await import('./useWebSocket');
const { useAuthStore } = await import('../stores/authStore');
const { useUIStore } = await import('../stores/uiStore');
const { initI18n } = await import('../i18n');
const i18n = (await import('../i18n')).default;

// #420: a WebSocket refusal of a DM message action carries an error code,
// and `details` where the code's text has placeholders. The client shows it
// as a toast in the user's language with the placeholders filled.

function homeSocket(): TestWebSocket {
  renderHook(() => useWebSocket());
  const ws = TestWebSocket.all.at(-1)!;
  ws.open();
  return ws;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await initI18n();
  installSocketHarness(); useAuthStore.setState({ token: 'native-token' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  useUIStore.setState({ toasts: [] });
});

afterEach(() => {
  cleanup(); useAuthStore.setState({ token: null }); vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a coded WebSocket refusal', () => {
  it('shows the translated text of recipient_deleted', () => {
    const ws = homeSocket();

    ws.deliver({ type: 'error', message: "This user's account was deleted", code: 'recipient_deleted' });

    const toasts = useUIStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.message).toBe(i18n.t('errors:recipient_deleted'));
    expect(recordDiagnostic).toHaveBeenCalledWith({ event: 'ws-error', subsystem: 'websocket', level: 'error', errorCode: 'recipient_deleted' });
  });

  it('fills the placeholders from details', () => {
    const ws = homeSocket();

    ws.deliver({
      type: 'error',
      message: 'Message content must be 4000 characters or less',
      code: 'content_too_long',
      details: { max: 4000 },
    });

    const toasts = useUIStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.message).toBe(i18n.t('errors:content_too_long', { max: 4000 }));
    expect(toasts[0]!.message).toContain('4000');
  });

  it('only logs an error without a code', () => {
    const ws = homeSocket();

    ws.deliver({ type: 'error', message: 'Unknown event type: nope' });

    expect(useUIStore.getState().toasts).toHaveLength(0);
    expect(recordDiagnostic).toHaveBeenCalledWith({ event: 'ws-error', subsystem: 'websocket', level: 'error', errorCode: undefined });
  });
});
