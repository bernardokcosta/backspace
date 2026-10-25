interface Version {
  core: number[];
  prerelease: string[];
}

/** Bounded strict SemVer, with core numbers safely below integer overflow. */
function parse(value: unknown): Version | null {
  if (typeof value !== 'string' || value.length > 128) return null;
  const match = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match) return null;
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some((id) => /^\d+$/.test(id) && id.length > 1 && id.startsWith('0'))) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease };
}

export function compareDesktopVersions(left: string, right: string): -1 | 0 | 1 | null {
  const a = parse(left); const b = parse(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i++) {
    if (a.core[i]! < b.core[i]!) return -1;
    if (a.core[i]! > b.core[i]!) return 1;
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i]; const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x); const yn = /^\d+$/.test(y);
    if (xn && yn) { if (x.length !== y.length) return x.length < y.length ? -1 : 1; }
    else if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** Missing/null disables; malformed remote policy must not quietly disable. */
export function parseMinimumDesktopVersion(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const version = parse(value);
  if (!version || version.prerelease.length) throw new Error('Minimum desktop version must be a stable SemVer');
  return value as string;
}

export function desktopCompatibilityDecision(current: string | null, minimum: string | null): 'allowed' | 'update-required' | 'unknown-version' {
  if (minimum === null) return 'allowed';
  const order = current === null ? null : compareDesktopVersions(current, minimum);
  return order === null ? 'unknown-version' : order < 0 ? 'update-required' : 'allowed';
}

export function identifyDesktop(userAgent: string): { kind: 'desktop'; version: string | null } | { kind: 'other' } {
  const ua = userAgent.slice(0, 4096);
  if (!/(?:BackspaceFork|Electron)\//i.test(ua)) return { kind: 'other' };
  const tokens = [...ua.matchAll(/(?:^|[\s;(])BackspaceFork\/([^\s;)]+)/gi)];
  const version = tokens.length === 1 ? tokens[0]![1]! : null;
  // No guessed legacy package-name parser: Electron proves only shell kind,
  // never installed app version. Unknown shells require recovery when enabled.
  return { kind: 'desktop', version: version !== null && parse(version) ? version : null };
}
