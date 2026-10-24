import { describe, expect, it } from 'vitest';
import { afkTimeoutMs, resolveAfkTarget, shouldAfkMove } from './afkMove';

const voice = (id: string) => ({ id, type: 'voice' });
const text = (id: string) => ({ id, type: 'text' });

describe('resolveAfkTarget', () => {
  it('returns null when no channel is configured', () => {
    expect(resolveAfkTarget({ afkChannelId: null, afkTimeoutSeconds: 300 }, [voice('a')])).toBeNull();
  });

  it('returns the channel when it exists and is voice', () => {
    expect(resolveAfkTarget({ afkChannelId: 'a', afkTimeoutSeconds: 300 }, [voice('a'), text('b')])).toBe('a');
  });

  it('disables the move when the channel is gone or not voice anymore', () => {
    expect(resolveAfkTarget({ afkChannelId: 'gone', afkTimeoutSeconds: 300 }, [voice('a')])).toBeNull();
    expect(resolveAfkTarget({ afkChannelId: 'b', afkTimeoutSeconds: 300 }, [voice('a'), text('b')])).toBeNull();
  });
});

describe('afkTimeoutMs', () => {
  it('converts listed timeouts to milliseconds', () => {
    expect(afkTimeoutMs({ afkChannelId: 'a', afkTimeoutSeconds: 60 })).toBe(60_000);
    expect(afkTimeoutMs({ afkChannelId: 'a', afkTimeoutSeconds: 3600 })).toBe(3_600_000);
  });

  it('falls back to the default for unknown values', () => {
    expect(afkTimeoutMs({ afkChannelId: 'a', afkTimeoutSeconds: 7 })).toBe(300_000);
    expect(afkTimeoutMs({ afkChannelId: 'a', afkTimeoutSeconds: Number.NaN })).toBe(300_000);
    expect(afkTimeoutMs({ afkChannelId: 'a', afkTimeoutSeconds: undefined })).toBe(300_000);
    expect(afkTimeoutMs({ afkChannelId: null })).toBe(300_000);
  });
});

describe('shouldAfkMove', () => {
  const base = {
    connected: true,
    inDmCall: false,
    currentVoiceChannelId: 'general',
    afkChannelId: 'afk',
    lastActivityAt: 0,
    now: 300_000,
    timeoutMs: 300_000,
  };

  it('moves once the timeout elapses', () => {
    expect(shouldAfkMove(base)).toBe(true);
    expect(shouldAfkMove({ ...base, now: 299_999 })).toBe(false);
  });

  it('never moves while disconnected, in a DM call, unconfigured or already there', () => {
    expect(shouldAfkMove({ ...base, connected: false })).toBe(false);
    expect(shouldAfkMove({ ...base, inDmCall: true })).toBe(false);
    expect(shouldAfkMove({ ...base, currentVoiceChannelId: null })).toBe(false);
    expect(shouldAfkMove({ ...base, afkChannelId: null })).toBe(false);
    expect(shouldAfkMove({ ...base, currentVoiceChannelId: 'afk' })).toBe(false);
  });
});
