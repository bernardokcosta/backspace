import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '@veyvox/shared';
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../hooks/useWebSocket', () => ({ wsSend: send }));
import { activitiesFor, useActivityStore } from './activityStore';
const playing: Activity[] = [{ type: 'playing', name: 'Native game' }];
beforeEach(() => { useActivityStore.getState().reset(); send.mockClear(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('native activity identity and snapshot', () => {
  it('keys only by native user id, with no origin writers/replica rows', () => {
    useActivityStore.getState().setUserActivities('bob', playing);
    expect(activitiesFor(useActivityStore.getState().userActivities, 'bob')).toEqual(playing);
    expect(activitiesFor(useActivityStore.getState().userActivities, 'carol')).toEqual([]);
    for (const field of ['originRows', 'activityWriters', 'setOriginRows']) expect(useActivityStore.getState()).not.toHaveProperty(field);
  });
  it('replaces the whole current-server ready snapshot, dropping absent users and clearing empty activities', () => {
    useActivityStore.getState().setUserActivities('bob', playing); useActivityStore.getState().setUserActivities('carol', playing);
    useActivityStore.getState().initActivities({ bob: [], dave: playing });
    expect([...useActivityStore.getState().userActivities]).toEqual([['dave', playing]]);
    useActivityStore.getState().clearUserActivities('dave'); expect(useActivityStore.getState().userActivities.size).toBe(0);
  });
  it('reset drops a previous server snapshot even when the next user has an equal id', () => {
    useActivityStore.getState().initActivities({ bob: playing }); useActivityStore.getState().reset();
    useActivityStore.getState().initActivities({}); expect(activitiesFor(useActivityStore.getState().userActivities, 'bob')).toEqual([]);
  });
});
