import type { MediaTrackInfo } from './types';
import { sanitizeTrackUrl } from './trackUrl';
import type { MediaChangeCallback } from './darwinMedia';

let activeCallback: MediaChangeCallback | null = null;
let currentTrack: MediaTrackInfo | null = null;
let bus: unknown = null;
let pollTimer: NodeJS.Timeout | null = null;
/** Incremented on every (re)start and stop so in-flight polls cannot republish after death. */
let busGeneration = 0;

const PLAYER_NAME_MAP: Record<string, string> = {
  spotify: 'Spotify',
  'netease-cloud-music': '网易云音乐',
  qqmusic: 'QQ音乐',
  rhythmbox: 'Rhythmbox',
  vlc: 'VLC',
  cavalier: 'Cavalier',
  audacious: 'Audacious',
  amberol: 'Amberol',
  strawberry: 'Strawberry',
  clementine: 'Clementine',
  elisa: 'Elisa',
};

export function getPlayerDisplayName(busName: string): string {
  const sub = busName.replace(/^org\.mpris\.MediaPlayer2\./, '').toLowerCase();
  return PLAYER_NAME_MAP[sub] ?? (sub.charAt(0).toUpperCase() + sub.slice(1));
}

export function parseMprisMetadata(metadata: Record<string, unknown>, player: string): MediaTrackInfo | null {
  const getVal = (key: string): unknown => {
    const raw = metadata[key];
    if (raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
      return (raw as Record<string, unknown>).value;
    }
    return raw;
  };

  const titleVal = getVal('xesam:title');
  const title = typeof titleVal === 'string' ? titleVal.trim() : '';
  if (!title) return null;

  const artistVal = getVal('xesam:artist');
  let artist = '';
  if (Array.isArray(artistVal)) {
    artist = artistVal.filter((a) => typeof a === 'string').join(', ').trim();
  } else if (typeof artistVal === 'string') {
    artist = artistVal.trim();
  }

  const albumVal = getVal('xesam:album');
  const album = typeof albumVal === 'string' ? albumVal.trim() : undefined;

  const lengthVal = getVal('mpris:length');
  let durationMs: number | undefined;
  if (typeof lengthVal === 'number' || typeof lengthVal === 'bigint') {
    // MPRIS length is in microseconds
    durationMs = Math.round(Number(lengthVal) / 1000);
  }

  const artUrlVal = getVal('mpris:artUrl');
  let artUrl: string | undefined;
  if (typeof artUrlVal === 'string' && artUrlVal.startsWith('https://')) {
    artUrl = artUrlVal;
  }

  const urlVal = getVal('xesam:url');
  const sourceUrl = typeof urlVal === 'string' ? sanitizeTrackUrl(urlVal) : undefined;

  return {
    title,
    artist,
    album,
    artUrl,
    durationMs,
    isPlaying: true,
    player,
    sourceUrl,
  };
}

export function startLinuxMedia(callback: MediaChangeCallback): void {
  activeCallback = callback;
  if (process.platform !== 'linux') return;

  try {
    // Dynamic import dbus-next to avoid loading native dbus in non-linux environments
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dbus = require('dbus-next');
    bus = dbus.sessionBus();

    // P2: D-Bus emits async errors via EventEmitter; the surrounding try/catch
    // cannot observe them. Without a listener an unavailable bus crashes the
    // desktop process instead of degrading media detection.
    const generation = ++busGeneration;
    const emitter = bus as { on?: (ev: string, fn: (err: unknown) => void) => void };
    emitter.on?.('error', (err) => {
      console.warn('[MediaDetector] Linux MPRIS bus error:', err);
      // A dead bus must not leave a ghost track: clear and notify so the UI
      // stops showing a song that is no longer observable (review finding).
      stopLinuxMediaPollOnly();
      if (currentTrack !== null) {
        currentTrack = null;
        activeCallback?.(null);
      }
    });

    const checkMpris = async () => {
      if (generation !== busGeneration) return;
      try {
        const messageBus = bus as {
          getProxyObject: (dest: string, path: string) => Promise<{
            getInterface: (iface: string) => {
              ListNames?: () => Promise<string[]>;
              Get?: (ifaceName: string, prop: string) => Promise<unknown>;
            };
          }>;
        };
        if (!messageBus || typeof messageBus.getProxyObject !== 'function') return;

        const dbusObj = await messageBus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
        if (generation !== busGeneration) return;
        const dbusIface = dbusObj.getInterface('org.freedesktop.DBus');
        const names = (await dbusIface.ListNames?.()) ?? [];
        if (generation !== busGeneration) return;
        const mprisNames = (names as string[]).filter((n) => n.startsWith('org.mpris.MediaPlayer2.'));

        for (const name of mprisNames) {
          if (generation !== busGeneration) return;
          try {
            const playerObj = await messageBus.getProxyObject(name, '/org/mpris/MediaPlayer2');
            if (generation !== busGeneration) return;
            const props = playerObj.getInterface('org.freedesktop.DBus.Properties');
            const statusRaw = await props.Get?.('org.mpris.MediaPlayer2.Player', 'PlaybackStatus');
            if (generation !== busGeneration) return;
            const status = statusRaw && typeof statusRaw === 'object' && 'value' in (statusRaw as Record<string, unknown>)
              ? (statusRaw as { value?: unknown }).value
              : statusRaw;
            if (status === 'Playing') {
              const metaRaw = await props.Get?.('org.mpris.MediaPlayer2.Player', 'Metadata');
              const metaDict = metaRaw && typeof metaRaw === 'object' && 'value' in (metaRaw as Record<string, unknown>)
                ? ((metaRaw as { value?: Record<string, unknown> }).value ?? {})
                : {};
              const parsed = parseMprisMetadata(metaDict as Record<string, unknown>, getPlayerDisplayName(name));
              if (parsed) {
                if (
                  !currentTrack ||
                  currentTrack.title !== parsed.title ||
                  currentTrack.artist !== parsed.artist ||
                  currentTrack.player !== parsed.player
                ) {
                  currentTrack = parsed;
                  activeCallback?.(currentTrack);
                }
                return;
              }
            }
          } catch {
            // Player may have disconnected or not support Player interface
          }
        }

        if (currentTrack !== null) {
          currentTrack = null;
          activeCallback?.(null);
        }
      } catch {
        // D-Bus query error
      }
    };

    checkMpris();
    pollTimer = setInterval(checkMpris, 5000);
  } catch (err) {
    console.warn('[MediaDetector] dbus-next initialization skipped or failed:', err);
  }
}

/** Stop polling/disconnect without clearing the selected track callback state twice. */
function stopLinuxMediaPollOnly(): void {
  busGeneration++;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (bus) {
    try {
      (bus as { disconnect?: () => void }).disconnect?.();
    } catch {}
    bus = null;
  }
}

export function stopLinuxMedia(): void {
  busGeneration++;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (bus) {
    try {
      (bus as { disconnect?: () => void }).disconnect?.();
    } catch {}
    bus = null;
  }
  currentTrack = null;
  activeCallback = null;
}
