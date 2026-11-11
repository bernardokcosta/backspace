import { config } from '../config.js';

/** Current instance's public base for durable native asset/invitation URLs.
 * Never a user-supplied destination or a registry of alternate servers. */
export function getPublicOrigin(): string {
  const override = config.publicOrigin?.trim();
  if (override) return override.replace(/\/$/, '');
  if (config.domain) return `https://${config.domain}`;
  return `http://localhost:${config.port}`;
}
