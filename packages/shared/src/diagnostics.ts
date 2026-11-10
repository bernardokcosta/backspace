import { isErrorCode } from './errors.js';

export const DIAGNOSTIC_EVENTS = [
  'runtime-error', 'unhandled-rejection', 'console-error', 'console-warning',
  'api-failed', 'ws-error', 'ws-closed', 'ws-reconnect', 'voice-state',
  'desktop-recovery', 'desktop-update', 'desktop-keybind',
  'server-log', 'server-console', 'server-started', 'server-stopped', 'csp-violation',
] as const;
export const DIAGNOSTIC_SUBSYSTEMS = ['app', 'api', 'websocket', 'voice', 'desktop', 'server', 'security'] as const;
export interface DiagnosticEvent {
  event: typeof DIAGNOSTIC_EVENTS[number];
  subsystem: typeof DIAGNOSTIC_SUBSYSTEMS[number];
  level: 'info' | 'warning' | 'error';
  version?: string;
  desktopVersion?: string;
  client?: 'web' | 'desktop';
  at?: number;
  count?: number;
  status?: number;
  reason?: number;
  attempt?: number;
  durationMs?: number;
  method?: string;
  route?: string;
  state?: string;
  directive?: string;
  errorName?: string;
  errorCode?: string;
  frames?: string[];
}

const ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError',
  'EvalError', 'AggregateError', 'AbortError', 'TimeoutError', 'NetworkError', 'NotAllowedError',
  'NotFoundError', 'NotReadableError', 'NotSupportedError', 'SecurityError', 'InvalidStateError',
  'OverconstrainedError', 'OperationError', 'ConnectionError', 'TrackInvalidError', 'MediaDeviceFailure']);
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EADDRINUSE', 'EADDRNOTAVAIL',
  'ENOENT', 'ENOSPC', 'EACCES', 'EPERM', 'EPIPE', 'ERR_NETWORK', 'ERR_CONNECTION_CLOSED', 'ERR_INTERNET_DISCONNECTED']);
const STATES = new Set(['connecting', 'connected', 'reconnecting', 'signalReconnecting', 'disconnected',
  'load-failed', 'render-gone', 'unresponsive', 'renderer-stalled', 'failed', 'error', 'ready',
  'checking', 'idle', 'normal', 'recovery', 'available', 'downloading', 'up-to-date', 'available-manual',
  'downloaded', 'external']);
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const DIRECTIVES = new Set(['default-src', 'script-src', 'script-src-elem', 'script-src-attr', 'style-src',
  'style-src-elem', 'style-src-attr', 'img-src', 'font-src', 'connect-src', 'media-src', 'object-src',
  'frame-src', 'frame-ancestors', 'worker-src', 'base-uri', 'form-action']);
// Only static API vocabulary survives. Dynamic ids, invite codes, filenames,
// search terms, origins and all query/hash data are never diagnostic fields.
const ROUTE_PARTS = new Set(['api', 'auth', 'login', 'register', 'users', '@me', 'spaces', 'channels',
  'messages', 'dm', 'pins', 'reactions', 'members', 'roles', 'settings', 'admin', 'instance', 'info',
  'health', 'files', 'uploads', 'livekit', 'token', 'soundboard', 'play', 'social', 'friends',
  'requests', 'search', 'stickers', 'sticker-store', 'packs', 'sticker-packs', 'federation',
  'join-requests', 'request-join', 'join', 'invites', 'bots', 'diagnostics', 'updates',
  'federation-registry', 'federation-credential', 'verify-password', 'change-password']);
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[a-zA-Z0-9.-]{1,32})?$/;
const FRAME = /^[a-zA-Z0-9_.-]{1,100}\.(?:[cm]?js|tsx?):\d{1,8}:\d{1,8}$/;

export function diagnosticRoute(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return;
  return value.split(/[?#]/, 1)[0]!.split('/').slice(0, 17)
    .map(part => !part || ROUTE_PARTS.has(part) ? part : ':id').join('/');
}

/** ErrorEvent sometimes exposes a script location but no Error/stack object. */
export function diagnosticLocation(filename: unknown, line: unknown, column: unknown): Pick<DiagnosticEvent, 'frames'> {
  if (typeof filename !== 'string' || filename.length > 16_384
      || !/^(?:https?:\/\/|file:\/\/\/|\/|[a-zA-Z]:[\\/])/.test(filename)
      || typeof line !== 'number' || !Number.isSafeInteger(line) || line < 1 || line > 99_999_999
      || typeof column !== 'number' || !Number.isSafeInteger(column) || column < 0 || column > 99_999_999) return {};
  let pathname = filename;
  if (/^(?:https?:\/\/|file:\/\/\/)/.test(filename)) {
    try { pathname = new URL(filename).pathname; } catch { return {}; }
  } else if (filename.startsWith('//')) return {};
  const basename = pathname.split(/[?#]/, 1)[0]!.split(/[\\/]/).at(-1);
  const frame = `${basename}:${line}:${column}`;
  return FRAME.test(frame) ? { frames: [frame] } : {};
}

export function diagnosticError(value: unknown): Pick<DiagnosticEvent, 'errorName' | 'errorCode' | 'frames'> {
  if (typeof value !== 'object' || value === null) return {};
  const error = value as Record<string, unknown>;
  const result: Pick<DiagnosticEvent, 'errorName' | 'errorCode' | 'frames'> = {};
  const name = error.name ?? error.type;
  if (typeof name === 'string' && ERROR_NAMES.has(name)) result.errorName = name;
  if (typeof error.code === 'string' && (NETWORK_CODES.has(error.code) || isErrorCode(error.code))) result.errorCode = error.code;
  if (typeof error.stack === 'string' && typeof error.message === 'string' && error.message.length <= 16_384) {
    const stack = error.stack;
    const firstLine = stack.slice(0, 256).split('\n', 1)[0]!;
    const headerName = firstLine.split(': ', 1)[0]!;
    // V8 includes the entire message before its code frames. Verify and remove
    // that exact prefix, including embedded newlines/fake "at" lines. Unknown
    // stack formats lose frames rather than exposing free-text exception data.
    if (/^[a-zA-Z][a-zA-Z0-9_]{0,63}(?: \[[A-Z0-9_]{1,64}\])?$/.test(headerName)) {
      const prefix = error.message ? `${headerName}: ${error.message}` : headerName;
      if (stack.startsWith(prefix) && (stack.length === prefix.length || stack[prefix.length] === '\n')) {
        const frames: string[] = [];
        for (const line of stack.slice(prefix.length, prefix.length + 16_384).split('\n')) {
          if (!/^\s+at\s+/.test(line)) continue;
          const match = /[/\\]([a-zA-Z0-9_.-]+\.(?:[cm]?js|tsx?)):(\d{1,8}):(\d{1,8})\)?\s*$/.exec(line);
          const frame = match ? `${match[1]}:${match[2]}:${match[3]}` : '';
          if (FRAME.test(frame)) frames.push(frame);
          if (frames.length === 8) break;
        }
        if (frames.length) result.frames = frames;
      }
    }
  }
  return result;
}

/** Both sides normalize: renderer input is never trusted as a log object. */
export function normalizeDiagnostic(value: unknown): DiagnosticEvent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!(DIAGNOSTIC_EVENTS as readonly unknown[]).includes(raw.event)
      || !(DIAGNOSTIC_SUBSYSTEMS as readonly unknown[]).includes(raw.subsystem)
      || typeof raw.level !== 'string' || !['info', 'warning', 'error'].includes(raw.level)) return null;
  const event: DiagnosticEvent = { event: raw.event as DiagnosticEvent['event'],
    subsystem: raw.subsystem as DiagnosticEvent['subsystem'], level: raw.level as DiagnosticEvent['level'] };
  for (const key of ['version', 'desktopVersion'] as const) {
    if (typeof raw[key] === 'string' && VERSION.test(raw[key])) event[key] = raw[key];
  }
  if (raw.client === 'web' || raw.client === 'desktop') event.client = raw.client;
  for (const [key, max] of [['at', 8_640_000_000_000_000], ['count', 10_000], ['status', 599],
    ['reason', 65_535], ['attempt', 10_000], ['durationMs', 86_400_000]] as const) {
    const number = raw[key];
    if (typeof number === 'number' && Number.isSafeInteger(number) && number >= 0 && number <= max) event[key] = number;
  }
  if (typeof raw.method === 'string' && METHODS.has(raw.method)) event.method = raw.method;
  const route = diagnosticRoute(raw.route); if (route) event.route = route;
  if (typeof raw.state === 'string' && STATES.has(raw.state)) event.state = raw.state;
  if (typeof raw.directive === 'string' && DIRECTIVES.has(raw.directive)) event.directive = raw.directive;
  Object.assign(event, diagnosticError({ name: raw.errorName, code: raw.errorCode }));
  if (Array.isArray(raw.frames)) {
    const frames = raw.frames.slice(0, 8).filter((frame): frame is string => typeof frame === 'string' && FRAME.test(frame));
    if (frames.length) event.frames = frames;
  }
  return event;
}
