import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { TransferIndicator } from './TransferIndicator';
import { useAuthStore } from '../../stores/authStore';
import { useTransferStore } from '../../stores/transferStore';
import { junoUser } from '../games/junoTestFixtures';
afterEach(cleanup);
describe('transfer tray privacy', () => {
  it('keeps native work but does not reveal another account filename', () => {
    useTransferStore.setState({ transfers: new Map() }); useAuthStore.setState({ user: junoUser('owner') });
    const id = useTransferStore.getState().createTransfer({ type: 'upload', tray: true, file: { name: 'Private filename', size: 1, mimetype: 'text/plain' } });
    render(<TransferIndicator />); fireEvent.click(screen.getByRole('button', { name: 'Transfers' }));
    expect(screen.getByText('Private filename')).toBeInTheDocument();
    act(() => useAuthStore.setState(s => ({ user: junoUser('next'), sessionRevision: s.sessionRevision + 1 })));
    expect(screen.queryByText('Private filename')).toBeNull(); expect(useTransferStore.getState().get(id)).toBeDefined();
  });
});
