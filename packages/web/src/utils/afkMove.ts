import { AFK_TIMEOUT_OPTIONS, DEFAULT_AFK_TIMEOUT_SECONDS } from '@backspace/shared/src/constants.js';

export interface AfkSpaceConfig {
  afkChannelId?: string | null;
  afkTimeoutSeconds?: number;
}

export interface AfkChannelLike {
  id: string;
  type: string;
}

/**
 * The effective AFK target: the configured channel when it exists and is
 * still a voice channel, otherwise null (feature off). A deleted channel or
 * one converted to text disables the move instead of failing it.
 */
export function resolveAfkTarget(space: AfkSpaceConfig, channels: AfkChannelLike[]): string | null {
  if (!space.afkChannelId) return null;
  const target = channels.find((c) => c.id === space.afkChannelId);
  if (!target || target.type !== 'voice') return null;
  return target.id;
}

/** Validated timeout in milliseconds; missing or unknown values fall back to the default. */
export function afkTimeoutMs(space: AfkSpaceConfig): number {
  const t = space.afkTimeoutSeconds;
  const valid = typeof t === 'number' && (AFK_TIMEOUT_OPTIONS as readonly number[]).includes(t) ? t : DEFAULT_AFK_TIMEOUT_SECONDS;
  return valid * 1000;
}

export function shouldAfkMove(args: {
  connected: boolean;
  inDmCall: boolean;
  currentVoiceChannelId: string | null;
  afkChannelId: string | null;
  lastActivityAt: number;
  now: number;
  timeoutMs: number;
}): boolean {
  if (!args.connected || args.inDmCall) return false;
  if (!args.currentVoiceChannelId || !args.afkChannelId) return false;
  if (args.currentVoiceChannelId === args.afkChannelId) return false;
  return args.now - args.lastActivityAt >= args.timeoutMs;
}
