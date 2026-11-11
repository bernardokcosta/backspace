/** An explicit current-server base must be an HTTP(S) origin, never a URL path. */
function currentServerOrigin(instanceOrigin?: string): string {
  const base = new URL(instanceOrigin?.trim() || window.location.origin);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password
    || base.pathname !== '/' || base.search || base.hash) {
    throw new Error(i18n.t('uploads:failure.invalidResponse'));
  }
  return base.origin;
}

/**
 * Resolve a tus Location against the selected current server, retaining its
 * scheme/host/port. Validate before exposing the URL to a credentialed request:
 * a server response or persisted absolute URL is not trusted routing authority.
 */
export function resolveTusUrl(location: string, instanceOrigin?: string): string {
  const origin = currentServerOrigin(instanceOrigin);
  const target = new URL(location, origin);
  if (target.origin !== origin || target.username || target.password || target.search || target.hash
    || !/^\/api\/files\/[A-Za-z0-9_-]+$/.test(target.pathname)) {
    throw new Error(i18n.t('uploads:failure.invalidResponse'));
  }
  return target.toString();
}

/** Absolute tus creation endpoint for the selected current server. */
export function tusEndpoint(instanceOrigin?: string): string {
  return `${currentServerOrigin(instanceOrigin)}/api/files/`;
}
import i18n from '../i18n';
