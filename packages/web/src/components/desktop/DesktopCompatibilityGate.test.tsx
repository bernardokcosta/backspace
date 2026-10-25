import { StrictMode, useEffect } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const effects = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), initialize: vi.fn(), update: vi.fn(), end: vi.fn() }));
vi.mock('../../stores/pendingMessageRehydrate', () => ({ startPendingMessageOrchestrator: () => { effects.start(); return effects.stop; } }));
vi.mock('../../hooks/useWebSocket', () => ({ disconnectAllRemote: effects.disconnect }));
vi.mock('../../stores/voiceStore', () => ({ useVoiceStore: { getState: () => ({ handleForceDisconnect: effects.end, setIncomingCall: vi.fn(), setOutgoingCall: vi.fn() }) } }));
vi.mock('../../stores/screenShareSetupStore', () => ({ useScreenShareSetupStore: { getState: () => ({ close: vi.fn() }) } }));
vi.mock('./RequiredDesktopUpdate', () => ({ RequiredDesktopUpdate: () => <div data-testid="required" /> }));
import { DesktopCompatibilityGate } from './DesktopCompatibilityGate';
import { useDesktopCompatibilityStore } from '../../stores/desktopCompatibilityStore';
import { useUpdateStore } from '../../stores/updateStore';
const mount = vi.fn(); const unmount = vi.fn();
function Session() { useEffect(() => { mount(); return unmount; }, []); return <div data-testid="session" />; }
beforeEach(() => {
  vi.clearAllMocks(); effects.initialize.mockReturnValue(vi.fn()); effects.update.mockReturnValue(vi.fn());
  useDesktopCompatibilityStore.setState({ phase: 'checking', initialize: effects.initialize });
  useUpdateStore.setState({ initialize: effects.update });
});
afterEach(cleanup);
describe('root compatibility gate', () => {
  it('never mounts session/pending work until allow, but keeps updater recovery alive', () => {
    render(<DesktopCompatibilityGate><Session /></DesktopCompatibilityGate>);
    expect(screen.getByTestId('required')).toBeInTheDocument(); expect(mount).not.toHaveBeenCalled(); expect(effects.start).not.toHaveBeenCalled();
    expect(effects.update).toHaveBeenCalledOnce();
    act(() => useDesktopCompatibilityStore.setState({ phase: 'allowed' }));
    expect(screen.getByTestId('session')).toBeInTheDocument(); expect(effects.start).toHaveBeenCalledOnce();
    act(() => useDesktopCompatibilityStore.setState({ phase: 'required' }));
    expect(screen.queryByTestId('session')).not.toBeInTheDocument(); expect(unmount).toHaveBeenCalledOnce();
    expect(effects.stop).toHaveBeenCalledOnce(); expect(effects.disconnect).toHaveBeenCalledOnce(); expect(effects.end).toHaveBeenCalledOnce();
    expect(effects.update).toHaveBeenCalledOnce();
  });
  it('balances lifecycle under StrictMode and preserves retry access for failures', () => {
    useDesktopCompatibilityStore.setState({ phase: 'allowed' });
    const view = render(<StrictMode><DesktopCompatibilityGate><Session /></DesktopCompatibilityGate></StrictMode>);
    expect(effects.start).toHaveBeenCalledTimes(2); expect(effects.stop).toHaveBeenCalledOnce();
    act(() => useDesktopCompatibilityStore.setState({ phase: 'failed' }));
    expect(screen.getByTestId('required')).toBeInTheDocument(); expect(effects.stop).toHaveBeenCalledTimes(2);
    view.unmount(); expect(effects.stop).toHaveBeenCalledTimes(2);
  });
});
