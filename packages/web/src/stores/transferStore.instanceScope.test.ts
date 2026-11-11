import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequest, HttpResponse, UploadOptions } from 'tus-js-client';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
const wire = vi.hoisted(() => ({ sent: [] as Array<{ method: string; url: string; authorization?: string }>,
  location: '/api/files/upload-1', blockPatches: false, options: [] as UploadOptions[] }));
const handles = vi.hoisted(() => ({ get: vi.fn(), permission: vi.fn(), query: vi.fn(), put: vi.fn() }));
vi.mock('../utils/idbHandles', () => ({ getHandle: handles.get, ensurePermission: handles.permission,
  queryHandlePermission: handles.query, putHandle: handles.put }));
vi.mock('tus-js-client', async original => {
  const actual = await original<typeof import('tus-js-client')>();
  return { ...actual, Upload: class extends actual.Upload {
    constructor(file: File | Blob, options: UploadOptions) {
      wire.options.push(options);
      super(file, { ...options, retryDelays: [], fileReader: { openFile: async () => ({ size: file.size,
        slice: async (start: number, end: number) => ({ value: file.slice(start, end), done: end >= file.size }), close: () => {} }) },
        httpStack: { getName: () => 'disposable-fixture', createRequest(method: string, url: string): HttpRequest {
          const headers = new Map<string, string>();
          return { getMethod: () => method, getURL: () => url, setHeader: (key, value) => { headers.set(key.toLowerCase(), value); },
            getHeader: key => headers.get(key.toLowerCase()), setProgressHandler: () => {}, abort: async () => {}, getUnderlyingObject: () => ({}),
            send: async (): Promise<HttpResponse> => {
              wire.sent.push({ method, url, authorization: headers.get('authorization') });
              if (method === 'PATCH' && wire.blockPatches) return new Promise(() => {});
              return { getStatus: () => method === 'POST' ? 201 : 200, getUnderlyingObject: () => ({}),
                getHeader: key => ({ Location: wire.location, 'Upload-Offset': method === 'PATCH' ? String(file.size) : '0', 'Upload-Length': String(file.size), 'Upload-Expires': new Date(Date.now() + 60_000).toUTCString() })[key],
                getBody: () => JSON.stringify({ id: 'attachment', filename: 'image.png' }),
              };
            } };
        } },
      });
    }
  } };
});
import { useAuthStore } from './authStore';
import { useTransferStore } from './transferStore';
import { junoUser } from '../components/games/junoTestFixtures';
const file = () => new File(['native bytes'], 'image.png', { type: 'image/png' });
beforeEach(() => {
  wire.sent.length = 0; wire.options.length = 0; wire.location = '/api/files/upload-1'; wire.blockPatches = false;
  useTransferStore.setState({ transfers: new Map(), hasInMemoryFile: new Set() });
  useAuthStore.setState({ token: 'current-jwt', user: junoUser('same-id') }); vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
  handles.get.mockReset(); handles.permission.mockReset().mockResolvedValue('granted'); handles.query.mockReset().mockResolvedValue('granted'); handles.put.mockReset();
});
afterEach(() => { for (const transfer of useTransferStore.getState().transfers.values()) useTransferStore.getState().pauseUpload(transfer.id); vi.unstubAllGlobals(); });
const wait = async (predicate: () => void) => { await vi.waitFor(predicate, { timeout: 1500 }); };
describe('current-server transfer authority', () => {
  it('does not normalize later live work when boot restored an empty transfer map', async () => {
    localStorage.setItem('transferStore@v1', JSON.stringify({ version: 1, state: { transfers: [] } }));
    await useTransferStore.persist.rehydrate(); await Promise.resolve();
    wire.blockPatches = true;
    const id = await useTransferStore.getState().startUpload(file(), {});
    await wait(() => expect(wire.sent.some(row => row.method === 'PATCH')).toBe(true));
    useAuthStore.getState().setUser(junoUser('same-id')); await Promise.resolve();
    expect(useTransferStore.getState().get(id)?.state).toBe('active');
    expect(wire.sent.map(row => row.method)).toEqual(['POST', 'PATCH']);
  });
  it('pins new native transfers to the current server and account', async () => {
    const id = await useTransferStore.getState().startUpload(file(), {});
    await wait(() => expect(useTransferStore.getState().get(id)?.state).toBe('completed'));
    expect(useTransferStore.getState().get(id)).toMatchObject({ origin: window.location.origin, uploaderUserId: 'same-id' });
    expect(wire.sent.map(row => row.url)).toEqual([`${window.location.origin}/api/files/`, `${window.location.origin}/api/files/upload-1`]);
    expect(wire.sent.every(row => row.authorization === 'Bearer current-jwt')).toBe(true);
  });
  it('never sends a bearer PATCH to a foreign Location returned by tus creation', async () => {
    wire.location = 'https://foreign.invalid/api/files/upload-1';
    const id = await useTransferStore.getState().startUpload(file(), {});
    await wait(() => expect(useTransferStore.getState().get(id)?.state).toBe('failed'));
    expect(wire.sent).toHaveLength(1); expect(wire.sent[0]?.method).toBe('POST');
  });
  it.each(['server', 'account'] as const)('keeps an earlier %s transfer paused instead of resuming it with the current bearer', async change => {
    wire.blockPatches = true;
    const id = await useTransferStore.getState().startUpload(file(), {});
    await wait(() => expect(wire.sent.some(row => row.method === 'PATCH')).toBe(true));
    useTransferStore.getState().pauseUpload(id); wire.sent.length = 0;
    if (change === 'server') vi.stubGlobal('window', { location: { origin: 'https://next.invalid' } });
    else useAuthStore.setState(s => ({ user: junoUser('next-account'), token: 'next-jwt', sessionRevision: s.sessionRevision + 1 }));
    await useTransferStore.getState().resumeUpload(id);
    expect(wire.sent).toEqual([]); expect(useTransferStore.getState().get(id)?.state).toBe('paused'); expect(fetch).not.toHaveBeenCalled();
  });
  it('does not DELETE an old server upload with the next server token', () => {
    const id = useTransferStore.getState().createTransfer({ type: 'upload', tray: true, uploaderUserId: 'same-id', file: { name: 'image', size: 1, mimetype: 'image/png' } });
    useTransferStore.setState(s => ({ transfers: new Map(s.transfers).set(id, { ...s.transfers.get(id)!, origin: 'https://old.invalid', tusUploadUrl: 'https://old.invalid/api/files/upload-1' }) }));
    useTransferStore.getState().abortUpload(id); expect(fetch).not.toHaveBeenCalled();
  });
  it('ignores callbacks and requests from the paused attempt after a native resume', async () => {
    wire.blockPatches = true;
    const id = await useTransferStore.getState().startUpload(file(), {});
    await wait(() => expect(wire.sent.some(row => row.method === 'PATCH')).toBe(true));
    const old = wire.options[0]!;
    useTransferStore.getState().pauseUpload(id); await useTransferStore.getState().resumeUpload(id);
    await wait(() => expect(wire.sent.some(row => row.method === 'HEAD')).toBe(true));
    const before = useTransferStore.getState().get(id);
    old.onProgress?.(999, 999);
    old.onSuccess?.({ lastResponse: { getBody: () => JSON.stringify({ id: 'old', filename: 'old' }) } as HttpResponse });
    old.onError?.(new Error('Old failure'));
    expect(useTransferStore.getState().get(id)).toEqual(before);
    expect(useTransferStore.getState().hasInMemoryFile.has(id)).toBe(true);
    const setHeader = vi.fn();
    expect(() => old.onBeforeRequest?.({ getMethod: () => 'PATCH', getURL: () => `${window.location.origin}/api/files/upload-1`, setHeader } as unknown as HttpRequest)).toThrow();
    expect(setHeader).not.toHaveBeenCalled(); expect(useTransferStore.getState().get(id)).toEqual(before);
  });
  it.each(['logout', 'initSession'] as const)('pauses active native work at %s without erasing bytes, URLs or handles', async action => {
    wire.blockPatches = true;
    const id = await useTransferStore.getState().startUpload(file(), { fileHandleId: 'retained-handle' });
    await wait(() => expect(wire.sent.some(row => row.method === 'PATCH')).toBe(true));
    if (action === 'logout') useAuthStore.getState().logout();
    else useAuthStore.getState().initSession('replacement', junoUser('replacement'));
    expect(useTransferStore.getState().get(id)).toMatchObject({ state: 'paused', fileHandleId: 'retained-handle', tusUploadUrl: `${window.location.origin}/api/files/upload-1` });
    expect(useTransferStore.getState().hasInMemoryFile.has(id)).toBe(true);
    expect(wire.sent.some(row => row.method === 'DELETE')).toBe(false);
  });
  it.each(['lookup', 'permission', 'file'] as const)('does not advance a native handle resume after session replacement during %s', async stage => {
    let finish!: (value: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const readFile = vi.fn().mockResolvedValue(file());
    const handle = { getFile: readFile };
    handles.get.mockResolvedValue(handle);
    if (stage === 'lookup') handles.get.mockReturnValueOnce(pending);
    if (stage === 'permission') handles.permission.mockReturnValueOnce(pending);
    if (stage === 'file') readFile.mockReturnValueOnce(pending);
    const id = useTransferStore.getState().createTransfer({ type: 'upload', tray: true, file: { name: 'image', size: 1, mimetype: 'image/png' }, fileHandleId: 'retained' });
    const resume = useTransferStore.getState().resumeUpload(id);
    await wait(() => expect(stage === 'lookup' ? handles.get : stage === 'permission' ? handles.permission : readFile).toHaveBeenCalled());
    useAuthStore.getState().initSession('new-jwt', junoUser('same-id'));
    finish(stage === 'lookup' ? handle : stage === 'permission' ? 'granted' : file()); await resume;
    expect(wire.sent).toEqual([]);
    if (stage === 'lookup') expect(handles.permission).not.toHaveBeenCalled();
    if (stage !== 'file') expect(readFile).not.toHaveBeenCalled();
    expect(useTransferStore.getState().get(id)?.state).toBe('paused');
  });
  it('resumes a valid native upload with HEAD and PATCH without creating another session', async () => {
    handles.get.mockResolvedValue({ getFile: async () => file() });
    const id = useTransferStore.getState().createTransfer({ type: 'upload', tray: true, file: { name: 'image', size: 1, mimetype: 'image/png' }, fileHandleId: 'retained' });
    useTransferStore.getState().setTusUrl(id, '/api/files/native', Date.now() + 60_000);
    await useTransferStore.getState().resumeUpload(id);
    await wait(() => expect(useTransferStore.getState().get(id)?.state).toBe('completed'));
    expect(wire.sent.map(row => row.method)).toEqual(['HEAD', 'PATCH']);
    expect(wire.sent.every(row => row.authorization === 'Bearer current-jwt')).toBe(true);
  });
  it.each(['loadUser', 'setUser', 'initSession'] as const)('defers restored own uploads until %s confirms the bootstrap identity, then resumes once', async action => {
    const id = useTransferStore.getState().createTransfer({ type: 'upload', tray: true,
      file: { name: 'restored', size: 12, mimetype: 'text/plain' }, fileHandleId: 'restored-handle' });
    const transfer = { ...useTransferStore.getState().get(id)!, state: 'active', tusUploadUrl: `${window.location.origin}/api/files/native`, tusExpiresAt: Date.now() + 60_000 };
    useAuthStore.setState({ user: null, token: 'current-jwt' });
    localStorage.setItem('transferStore@v1', JSON.stringify({ version: 1, state: { transfers: [[id, transfer]] } }));
    handles.get.mockResolvedValue({ getFile: async () => file() });
    await useTransferStore.persist.rehydrate(); await Promise.resolve();
    expect(handles.get).not.toHaveBeenCalled(); expect(wire.sent).toEqual([]);
    expect(useTransferStore.getState().get(id)?.state).toBe('paused');
    if (action === 'loadUser') {
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(junoUser('same-id')), { headers: { 'content-type': 'application/json' } }));
      await useAuthStore.getState().loadUser();
    } else if (action === 'setUser') useAuthStore.getState().setUser(junoUser('same-id'));
    else useAuthStore.getState().initSession('current-jwt', junoUser('same-id'));
    useAuthStore.getState().setUser(junoUser('same-id'));
    await wait(() => expect(useTransferStore.getState().get(id)?.state).toBe('completed'));
    expect(handles.query).toHaveBeenCalledOnce();
    expect(wire.sent.map(row => row.method)).toEqual(['HEAD', 'PATCH']);
    useTransferStore.getState().pauseUpload(id);
    const probes = handles.get.mock.calls.length;
    useAuthStore.getState().setUser(junoUser('same-id'));
    await Promise.resolve(); expect(handles.get).toHaveBeenCalledTimes(probes);
    expect(wire.sent).toHaveLength(2);
  });
  it.each(['account', 'server', 'unowned'] as const)('does not probe preserved %s work when bootstrap authenticates another scope', async mismatch => {
    const id = useTransferStore.getState().createTransfer({ type: 'upload', tray: true,
      file: { name: 'preserved', size: 12, mimetype: 'text/plain' }, fileHandleId: 'preserved-handle' });
    const transfer = { ...useTransferStore.getState().get(id)!, state: 'active',
      origin: mismatch === 'server' ? 'https://old.invalid' : window.location.origin,
      uploaderUserId: mismatch === 'account' ? 'different-id' : mismatch === 'unowned' ? undefined : 'same-id' };
    useAuthStore.setState({ user: null, token: 'current-jwt' });
    localStorage.setItem('transferStore@v1', JSON.stringify({ version: 1, state: { transfers: [[id, transfer]] } }));
    await useTransferStore.persist.rehydrate(); await Promise.resolve();
    useAuthStore.getState().setUser(junoUser('same-id')); await Promise.resolve();
    expect(handles.get).not.toHaveBeenCalled(); expect(wire.sent).toEqual([]);
    expect(useTransferStore.getState().get(id)).toMatchObject({ state: 'paused', fileHandleId: 'preserved-handle' });
  });
  it('does not probe restored handles from an unauthenticated profile snapshot', async () => {
    const id = useTransferStore.getState().createTransfer({ type: 'upload', tray: true,
      file: { name: 'preserved', size: 1, mimetype: 'text/plain' }, fileHandleId: 'preserved-handle' });
    const transfer = { ...useTransferStore.getState().get(id)!, state: 'active' };
    useAuthStore.setState({ token: null });
    localStorage.setItem('transferStore@v1', JSON.stringify({ version: 1, state: { transfers: [[id, transfer]] } }));
    await useTransferStore.persist.rehydrate(); await Promise.resolve();
    expect(handles.get).not.toHaveBeenCalled(); expect(wire.sent).toEqual([]);
    expect(useTransferStore.getState().get(id)?.state).toBe('paused');
  });
  it.each(['server', 'account', 'unowned'] as const)('rehydrates %s work without probing handles, resuming or destroying it', async mismatch => {
    const id = useTransferStore.getState().createTransfer({ type: 'upload', tray: true, file: { name: 'private', size: 1, mimetype: 'text/plain' }, fileHandleId: 'private-handle' });
    const transfer = { ...useTransferStore.getState().get(id)!, state: 'active',
      origin: mismatch === 'server' ? 'https://old.invalid' : window.location.origin,
      uploaderUserId: mismatch === 'account' ? 'other-user' : mismatch === 'unowned' ? undefined : 'same-id' };
    localStorage.setItem('transferStore@v1', JSON.stringify({ version: 1, state: { transfers: [[id, transfer]] } }));
    await useTransferStore.persist.rehydrate(); await Promise.resolve();
    expect(handles.get).not.toHaveBeenCalled(); expect(wire.sent).toEqual([]);
    expect(useTransferStore.getState().get(id)).toMatchObject({ state: 'paused', fileHandleId: 'private-handle' });
    expect(useTransferStore.getState().listVisible()).toEqual([]);
  });
  it('does not treat denied storage access as a failed hydration or lose in-memory work', async () => {
    const hydrated = vi.fn(); const unsubscribe = useTransferStore.persist.onFinishHydration(hydrated);
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    try {
      await useTransferStore.persist.rehydrate(); expect(hydrated).toHaveBeenCalledOnce();
      const id = await useTransferStore.getState().startUpload(file(), {});
      await wait(() => expect(useTransferStore.getState().get(id)?.state).toBe('completed'));
    } finally { get.mockRestore(); unsubscribe(); }
  });
  it('never prompts or writes an earlier account download destination when IDs repeat', async () => {
    const id = useTransferStore.getState().createTransfer({ type: 'download', tray: true, file: { name: 'private', size: 1, mimetype: 'text/plain' }, destFileHandleId: 'private', sourceUrl: '/api/uploads/private' });
    useTransferStore.getState().setState_(id, 'paused');
    useAuthStore.getState().initSession('next', junoUser('different'));
    await useTransferStore.getState().resumeDownload(id);
    expect(handles.get).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(useTransferStore.getState().get(id)?.state).toBe('paused');
  });
  it('does not open a writable or fetch after replacement during the save picker', async () => {
    let finish!: (value: unknown) => void;
    const picker = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const writable = vi.fn(); const handle = { createWritable: writable };
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: picker });
    try {
      const pending = useTransferStore.getState().startDownload('/api/uploads/native', { filename: 'native' });
      useAuthStore.getState().initSession('next', junoUser('same-id')); finish(handle);
      const id = await pending;
      expect(writable).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
      expect(useTransferStore.getState().get(id)?.state).toBe('paused');
    } finally { delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker; }
  });
  it('does not materialize a download blob after the receiving session is replaced', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const objectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture');
    try {
      const pending = useTransferStore.getState().startDownload('/api/uploads/native', { filename: 'native' });
      useAuthStore.getState().initSession('next', junoUser('same-id')); finish(new Response('private bytes'));
      const id = await pending;
      expect(objectUrl).not.toHaveBeenCalled(); expect(useTransferStore.getState().get(id)?.state).toBe('paused');
    } finally { objectUrl.mockRestore(); }
  });
  it.each(['valid', 'ignored', 'wrong-offset'] as const)('handles a %s native download Range response without corrupting partial bytes', async mode => {
    const write = vi.fn(), seek = vi.fn(), close = vi.fn();
    handles.get.mockResolvedValue({ getFile: async () => ({ size: 4 }), createWritable: async () => ({ write, seek, close }) });
    vi.mocked(fetch).mockResolvedValueOnce(new Response('suffix', { status: mode === 'ignored' ? 200 : 206,
      headers: { 'Content-Range': mode === 'wrong-offset' ? 'bytes 0-5/6' : 'bytes 4-9/10' } }));
    const id = useTransferStore.getState().createTransfer({ type: 'download', tray: true, file: { name: 'native', size: 10, mimetype: 'text/plain' }, destFileHandleId: 'native', sourceUrl: '/api/uploads/native' });
    await useTransferStore.getState().resumeDownload(id);
    expect(fetch).toHaveBeenCalledWith('/api/uploads/native', expect.objectContaining({ headers: { Range: 'bytes=4-' } }));
    if (mode === 'valid') { expect(write).toHaveBeenCalledOnce(); expect(useTransferStore.getState().get(id)?.state).toBe('completed'); }
    else { expect(write).not.toHaveBeenCalled(); expect(useTransferStore.getState().get(id)?.state).toBe('failed'); }
  });
});
