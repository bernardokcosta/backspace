/** Preserve Chromium identification; explicitly identify this installed app. */
export function desktopUserAgent(original: string, version: string): string {
  const token = version.length <= 128 && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
    ? version : 'unknown';
  return `${original.replace(/(?:^|\s)BackspaceFork\/[^\s]+/gi, '').trim()} BackspaceFork/${token}`;
}
