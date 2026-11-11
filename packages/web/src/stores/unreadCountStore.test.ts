import { beforeEach, describe, expect, it } from 'vitest';
import { useUnreadCountStore } from './unreadCountStore';

describe('unread count snapshots', () => {
  beforeEach(() => useUnreadCountStore.getState().reset());

  it('merges live native counts and replaces the full snapshot on reconnect', () => {
    const store = useUnreadCountStore.getState();
    store.hydrate({ a: 3, gone: 2 });
    store.updateCounts({ a: 0, b: 5 });
    expect(useUnreadCountStore.getState().counts).toEqual({ a: 0, gone: 2, b: 5 });
    store.hydrate({ a: 1 });
    expect(useUnreadCountStore.getState().counts).toEqual({ a: 1 });
  });

  it('forgets counts when the ready snapshot has none', () => {
    const store = useUnreadCountStore.getState();
    store.hydrate({ b: 5 });
    store.hydrate(undefined);
    expect(useUnreadCountStore.getState().counts).toEqual({});
  });

  it('can receive a follow-up before a snapshot', () => {
    useUnreadCountStore.getState().updateCounts({ b: 1 });
    expect(useUnreadCountStore.getState().counts).toEqual({ b: 1 });
  });
});
