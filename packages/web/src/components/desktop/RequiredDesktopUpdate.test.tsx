import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequiredDesktopUpdate } from './RequiredDesktopUpdate';
import { useDesktopCompatibilityStore } from '../../stores/desktopCompatibilityStore';
import { canInstallRequiredUpdate, useUpdateStore } from '../../stores/updateStore';
const install = vi.fn(); const download = vi.fn(); const check = vi.fn();
beforeEach(() => {
  useDesktopCompatibilityStore.setState({ phase: 'required', currentVersion: '1.15.0', minimumVersion: '1.15.1', error: null });
  useUpdateStore.setState({ snapshot: null, install, openDownloadPage: download, checkNow: check });
  for (const fn of [install, download, check]) fn.mockClear();
});
afterEach(() => { cleanup(); delete window.backspace; });
describe('required desktop updater', () => {
  it('allows install only for an actually ready compatible auto update, ignoring dismissal', () => {
    expect(canInstallRequiredUpdate(null, '1.15.1')).toBe(false);
    for (const version of ['1.15.0', '1.15.1-beta.1', 'junk']) expect(canInstallRequiredUpdate({ capability: 'auto', dismissedVersion: null, status: { phase: 'ready', version } }, '1.15.1')).toBe(false);
    for (const capability of ['manual', 'external'] as const) expect(canInstallRequiredUpdate({ capability, dismissedVersion: null, status: { phase: 'ready', version: '1.16.0' } }, '1.15.1')).toBe(false);
    expect(canInstallRequiredUpdate({ capability: 'auto', dismissedVersion: '1.15.1', status: { phase: 'ready', version: '1.15.1' } }, '1.15.1')).toBe(true);
  });
  it('has no Later/Escape/backdrop entry into the app and does not offer premature restart', () => {
    useUpdateStore.setState({ snapshot: { capability: 'auto', dismissedVersion: null, status: { phase: 'downloading', version: '1.15.1', percent: 42, bytesPerSecond: 1024 } } });
    render(<RequiredDesktopUpdate />);
    expect(screen.queryByRole('button', { name: /later|dismiss|restart and install/i })).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useDesktopCompatibilityStore.getState().phase).toBe('required'); expect(install).not.toHaveBeenCalled();
  });
  it('installs a compatible ready build even if previously dismissed, but rechecks readiness at click time', () => {
    useUpdateStore.setState({ snapshot: { capability: 'auto', dismissedVersion: '1.15.1', status: { phase: 'ready', version: '1.15.1' } } });
    render(<RequiredDesktopUpdate />);
    fireEvent.click(screen.getByRole('button', { name: /restart and install/i })); expect(install).toHaveBeenCalledOnce();
    act(() => useUpdateStore.setState({ snapshot: { capability: 'auto', dismissedVersion: null, status: { phase: 'failed', version: '1.15.1', message: 'failed' } } }));
    expect(screen.queryByRole('button', { name: /restart and install/i })).not.toBeInTheDocument();
  });
  it('shows real manual/external ownership and keeps trusted download and serving-browser recovery usable', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    useUpdateStore.setState({ snapshot: { capability: 'manual', dismissedVersion: null, status: { phase: 'idle' } } });
    render(<RequiredDesktopUpdate />);
    expect(screen.getByText(/download an installer/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /download installer/i })); expect(download).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /open in browser/i })); expect(open).toHaveBeenCalledWith(window.location.origin, '_blank', 'noopener');
    open.mockRestore();
    act(() => useUpdateStore.setState({ snapshot: { capability: 'external', dismissedVersion: null, status: { phase: 'idle' } } }));
    expect(screen.getByText(/package manager/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restart and install/i })).not.toBeInTheDocument();
  });
});
