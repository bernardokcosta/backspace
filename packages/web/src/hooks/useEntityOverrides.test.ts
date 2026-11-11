import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
const mocks = vi.hoisted(() => ({ getOverrides: vi.fn(), putOverride: vi.fn(), deleteOverride: vi.fn() }));
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), api: { channels: mocks, categories: mocks } }));
import { useEntityOverrides } from './useEntityOverrides';
import { useAuthStore } from '../stores/authStore';
const row = { targetType: 'role', targetId: 'everyone', allow: '1', deny: '0' };
beforeEach(() => { vi.clearAllMocks(); mocks.getOverrides.mockResolvedValue([row]); mocks.putOverride.mockResolvedValue(row); });
afterEach(cleanup);
describe('native override request ownership', () => {
  it.each(['channel', 'category'] as const)('loads and updates the native %s ID with optimistic concurrency versioning', async kind => {
    const { result } = renderHook(() => useEntityOverrides(kind, 'entity', true));
    await waitFor(() => expect(result.current.loaded).toBe(true)); expect(mocks.getOverrides).toHaveBeenCalledWith('entity');
    await act(async () => result.current.setBits('role', 'everyone', 2n, 'allow'));
    expect(mocks.putOverride).toHaveBeenCalledWith('entity', expect.objectContaining({ allow: '3', deny: '0', version: expect.any(String) }));
  });
  it('does not fetch when the native permission gate is disabled', () => {
    renderHook(() => useEntityOverrides('channel', 'entity', false)); expect(mocks.getOverrides).not.toHaveBeenCalled();
  });
  it('ignores an old-session listing even when the replacement entity ID is equal', async () => {
    let finish!: (rows: typeof row[]) => void;
    mocks.getOverrides.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce([]);
    const { result } = renderHook(() => useEntityOverrides('channel', 'entity', true));
    act(() => useAuthStore.setState(s => ({ sessionRevision: s.sessionRevision + 1 })));
    await waitFor(() => expect(mocks.getOverrides).toHaveBeenCalledTimes(2)); await act(async () => finish([row]));
    expect(result.current.overrides).toEqual([]);
  });
  it('does not reload or write the prior entity from a captured callback after navigation', async () => {
    const { result, rerender } = renderHook(({ id }) => useEntityOverrides('channel', id, true), { initialProps: { id: 'old' } });
    await waitFor(() => expect(result.current.loaded).toBe(true)); const previous = result.current;
    rerender({ id: 'new' }); await waitFor(() => expect(mocks.getOverrides).toHaveBeenCalledWith('new')); mocks.getOverrides.mockClear();
    await act(async () => previous.reload()); expect(mocks.getOverrides).not.toHaveBeenCalled();
    await expect(previous.put({ ...row, version: 'missing' })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.putOverride).not.toHaveBeenCalled();
  });
});
