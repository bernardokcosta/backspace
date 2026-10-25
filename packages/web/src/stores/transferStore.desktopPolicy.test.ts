import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ start: vi.fn(), abort: vi.fn(async () => {}), getHandle: vi.fn(), permission: vi.fn(async () => 'granted') }));
vi.mock('./authStore', () => ({ useAuthStore: { getState: () => ({ token: 'token', user: { id: 'user' } }) } }));
vi.mock('../utils/crossStoreResolvers', () => ({ getTokenForOrigin: () => 'token' }));
vi.mock('../utils/idbHandles', () => ({ getHandle: mocks.getHandle, putHandle: vi.fn(), ensurePermission: mocks.permission, queryHandlePermission: mocks.permission }));
vi.mock('tus-js-client', () => ({ Upload: class { start = mocks.start; abort = mocks.abort; url = null; } }));
import { useTransferStore } from './transferStore';
import { setDesktopSessionAllowed } from '../utils/desktopSessionAccess';
beforeEach(() => { setDesktopSessionAllowed(true); useTransferStore.setState({ transfers: new Map() }); vi.clearAllMocks(); });
afterEach(() => { setDesktopSessionAllowed(true); vi.restoreAllMocks(); });
describe('transfer desktop policy pause', () => {
  it('pauses an active upload, retains bytes/URL and does not resume until allowed', async () => {
    const store = useTransferStore.getState();
    const id = await store.startUpload(new File(['draft bytes'], 'draft.txt'), { channelId: 'channel' });
    store.setTusUrl(id, '/api/files/saved', 999999);
    expect(mocks.start).toHaveBeenCalledOnce();
    setDesktopSessionAllowed(false);
    expect(mocks.abort).toHaveBeenCalledWith(false);
    expect(store.get(id)).toMatchObject({ state: 'paused', tusUploadUrl: '/api/files/saved' });
    expect(useTransferStore.getState().hasInMemoryFile.has(id)).toBe(true);
    await store.resumeUpload(id); expect(mocks.start).toHaveBeenCalledOnce();
    setDesktopSessionAllowed(true); await store.resumeUpload(id); expect(mocks.start).toHaveBeenCalledTimes(2);
  });
  it('ignores a file-handle resume finishing after blocking and reallow', async () => {
    let reply: (handle: unknown) => void = () => {};
    mocks.getHandle.mockImplementationOnce(() => new Promise((resolve) => { reply = resolve; }));
    const store = useTransferStore.getState();
    const id = store.createTransfer({ type: 'upload', file: { name: 'draft', size: 5, mimetype: 'text/plain' }, tray: true, fileHandleId: 'saved' });
    store.setState_(id, 'paused');
    const resume = store.resumeUpload(id);
    setDesktopSessionAllowed(false); setDesktopSessionAllowed(true);
    reply({ getFile: async () => new File(['draft'], 'draft') }); await resume;
    expect(mocks.start).not.toHaveBeenCalled(); expect(store.get(id)?.state).toBe('paused');
  });
  it('does not acquire a picker, handle, upload or download while blocked', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    setDesktopSessionAllowed(false); const store = useTransferStore.getState();
    await expect(store.startUpload(new File(['x'], 'x'), {})).rejects.toMatchObject({ name: 'AbortError' });
    await expect(store.startDownload('https://files.test/x', { filename: 'x' })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled(); expect(store.transfers.size).toBe(0);
  });
});
