/** Main is CommonJS: keep this bounded parser independent of renderer/i18n. */
export function normalizeDeepLink(input: string): string | null {
  if (/[\u0000-\u0020\u007f\\]/.test(input)) return null;
  const match = /^(?:veyvox|backspace):\/\/(join|channel)\/([^?#]+)$/i.exec(input);
  if (!match) return null;
  let parts: string[];
  try { parts = match[2]!.split('/').map(part => decodeURIComponent(part)); } catch { return null; }
  const identifier = /^[A-Za-z0-9_-]+$/;
  if (match[1]!.toLowerCase() === 'channel') {
    if (parts.length !== 2 || !(identifier.test(parts[0]!) || parts[0] === '@me') || !identifier.test(parts[1]!)) return null;
    return `backspace://channel/${parts[0]}/${parts[1]}`;
  }
  if (parts.length !== 1) return null;
  const value = parts[0]!;
  const [code, host, ...extra] = value.split('@');
  if (!code || !identifier.test(code) || extra.length) return null;
  if (host !== undefined) {
    // Same bare-host grammar as web's existing buildInstanceJoinUrl owner.
    if (!/^(?:\[[0-9A-Fa-f:.]+\]|[^\s/?#@\\:]+)(?::\d{1,5})?$/.test(host)) return null;
    try {
      const target = new URL(`https://${host}/join/${code}`);
      if (!target.hostname || target.username || target.password || target.search || target.hash || target.pathname !== `/join/${code}`) return null;
    } catch { return null; }
  }
  return `backspace://join/${value}`;
}
