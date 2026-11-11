import { describe, it, expect } from 'vitest';
import { isChosenUserStatus } from '@veyvox/shared';
import { statusOnConnect } from './presenceStatus.js';

describe('isChosenUserStatus', () => {
  it.each(['online', 'idle', 'dnd'])('accepts %s', value => { expect(isChosenUserStatus(value)).toBe(true); });
  it.each(['offline', '', 'DND', null, undefined, 3])('rejects %s', value => { expect(isChosenUserStatus(value)).toBe(false); });
});
describe('native statusOnConnect', () => {
  it.each(['online', 'idle', 'dnd'])('publishes chosen %s rather than stale live status', chosenStatus => {
    const row = { chosenStatus, status: 'offline' }; expect(statusOnConnect(row)).toBe(chosenStatus);
  });
  it('falls back to online for an invalid stored choice', () => {
    const row = { chosenStatus: 'offline', status: 'offline' }; expect(statusOnConnect(row)).toBe('online');
  });
  it('obsolete identity fields cannot replace a retained local account\'s chosen status', () => {
    const row = { chosenStatus: 'idle', status: 'dnd', homeInstance: 'unused.invalid', federationHomeOrphaned: 0 };
    expect(statusOnConnect(row)).toBe('idle');
  });
});
