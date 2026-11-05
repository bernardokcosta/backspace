import { StrictMode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const effects = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock('./stores/pendingMessageRehydrate', () => ({ startPendingMessageOrchestrator: () => { effects.start(); return effects.stop; } }));
vi.mock('./stores/authStore', () => ({ useAuthStore: (select: (state: { token: null }) => unknown) => select({ token: null }) }));
vi.mock('./components/auth/LoginPage', () => ({ LoginPage: () => <div data-testid="login" /> }));
vi.mock('./components/auth/RegisterPage', () => ({ RegisterPage: () => null }));
vi.mock('./components/layout/AppLayout', () => ({ AppLayout: () => null }));
vi.mock('./components/JoinPage', () => ({ JoinPage: () => null }));
vi.mock('./components/ui/SwUpdatePrompt', () => ({ SwAutoUpdate: () => null }));
vi.mock('./components/voice/ScreenShareSetup', () => ({ ScreenShareSetup: () => null }));
vi.mock('./components/voice/SoundboardController', () => ({ SoundboardController: () => null }));
vi.mock('./components/games/JunoSession', () => ({ JunoSession: () => null }));
import { App } from './App';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Instance unavailable')));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('app startup without desktop compatibility checks', () => {
  it.each(['old', 'missing', 'failed'] as const)('opens login with a %s version bridge and unavailable policy', (version) => {
    const getVersion = vi.fn(() => version === 'failed' ? Promise.reject(new Error('IPC unavailable')) : Promise.resolve('1.0.0'));
    const rendererReady = vi.fn();
    vi.stubGlobal('backspace', { rendererReady, ...(version === 'missing' ? {} : { getVersion }) });
    render(<MemoryRouter initialEntries={['/login']}><App /></MemoryRouter>);
    expect(screen.getByTestId('login')).toBeInTheDocument();
    expect(getVersion).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(rendererReady).toHaveBeenCalledOnce();
    expect(effects.start).toHaveBeenCalledOnce();
  });

  it('balances pending-message startup and cleanup under StrictMode', () => {
    const view = render(<StrictMode><MemoryRouter initialEntries={['/login']}><App /></MemoryRouter></StrictMode>);
    expect(effects.start).toHaveBeenCalledTimes(2);
    expect(effects.stop).toHaveBeenCalledOnce();
    view.unmount();
    expect(effects.stop).toHaveBeenCalledTimes(2);
  });
});
