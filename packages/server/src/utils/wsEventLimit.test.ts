import { beforeEach, describe, expect, it } from 'vitest';
import { _resetActionLimits, consumeWsEvent, rateLimitEvent, wsEventRateLimitError } from './rateLimits.js';

beforeEach(_resetActionLimits);

describe('separate bounded real-time control admission', () => {
  it('only correlates refused call start/accept, never typing or message events', () => {
    for (const type of ['dm_typing_start', 'dm_message_create', 'dm_call_end', 'unknown']) {
      expect(wsEventRateLimitError(100, { type, dmChannelId: 'dm-1' })).not.toHaveProperty('dmChannelId');
    }
    expect(wsEventRateLimitError(100, { type: 'dm_call_start', dmChannelId: 'dm-1' })).toMatchObject({ dmChannelId: 'dm-1' });
    expect(wsEventRateLimitError(100, { type: 'dm_call_accept', dmChannelId: 'dm-2' })).toMatchObject({ dmChannelId: 'dm-2' });
    expect(wsEventRateLimitError(100, { type: 'dm_call_accept', federatedCallId: 'call-key' })).not.toHaveProperty('dmChannelId');
  });
  it('does not let ephemeral saturation spend call/voice control capacity', () => {
    for (let i = 0; i < 60; i++) expect(consumeWsEvent('alice', 'channel_ack', 0)).toBe(0);
    expect(consumeWsEvent('alice', 'typing_start', 0)).toBe(100);
    expect(consumeWsEvent('alice', 'voice_leave', 0)).toBe(0);
    expect(consumeWsEvent('alice', 'dm_call_end', 0)).toBe(0);
    expect(consumeWsEvent('alice', 'voice_status', 0)).toBe(0);
    expect(consumeWsEvent('bob', 'typing_start', 0)).toBe(0);
  });

  it('shares control capacity across event kinds and refuses a control flood with correlation', () => {
    for (let i = 0; i < 60; i++) expect(consumeWsEvent('alice', 'voice_status', 0)).toBe(0);
    const wait = consumeWsEvent('alice', 'dm_call_start', 0);
    expect(wait).toBe(100);
    expect(rateLimitEvent(wait, 'dm-1')).toMatchObject({ type: 'error', code: 'rate_limited', retryAfter: 1, dmChannelId: 'dm-1' });
    expect(consumeWsEvent('alice', 'voice_leave', 100)).toBe(0);
  });
});
