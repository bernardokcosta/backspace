import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { useSpaceStore } from '../stores/spaceStore';
import { getCanonicalUserView, useCanonicalUserView } from './userViewLookup';
import { junoUser } from '../components/games/junoTestFixtures';
const row = { ...junoUser('native'), username: 'native@retained.test', displayName: null };
beforeEach(() => useSpaceStore.getState().reset());
afterEach(cleanup);
describe('native cached profile lookup', () => {
  it('returns the original object unchanged on a cache miss', () => { expect(getCanonicalUserView(row)).toBe(row); });
  it('returns the exact current native cached object with no projected identity', () => {
    const fresh = { ...row, displayName: 'Fresh profile', avatarColor: 'sky' }; useSpaceStore.getState().upsertUserView(fresh);
    expect(getCanonicalUserView(row)).toBe(fresh); expect(getCanonicalUserView(row)).toBe(getCanonicalUserView(row));
  });
  it('never uses a same-username profile under another native ID', () => {
    useSpaceStore.getState().upsertUserView({ ...row, id: 'another', displayName: 'Other account' }); expect(getCanonicalUserView(row)).toBe(row);
  });
  it('keeps hook references stable until the native entry changes', () => {
    const fresh = { ...row, avatarColor: 'sky' }; useSpaceStore.getState().upsertUserView(fresh);
    const { result, rerender } = renderHook(() => useCanonicalUserView(row)); const first = result.current; rerender(); expect(result.current).toBe(first);
    const changed = { ...fresh, avatarColor: 'rose' }; act(() => useSpaceStore.getState().upsertUserView(changed)); expect(result.current).toBe(changed);
  });
  it('does not reuse the previous server profile after a native reset', () => {
    useSpaceStore.getState().upsertUserView({ ...row, displayName: 'Old server' }); useSpaceStore.getState().reset(); expect(getCanonicalUserView(row)).toBe(row);
  });
});
