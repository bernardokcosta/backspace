import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getElectronAPI } from './platform';
import { buildInstanceJoinUrl } from '../utils/inviteParser';

/** Only bounded in-app routes, never external navigation or arbitrary URLs. */
export function getDeepLinkRoute(input: string): string | null {
  if (/[\u0000-\u0020\u007f\\]/.test(input)) return null;
  const match = /^(?:veyvox|backspace):\/\/(join|channel)\/([^?#]+)$/i.exec(input);
  if (!match) return null;
  let parts: string[];
  try { parts = match[2]!.split('/').map(part => decodeURIComponent(part)); } catch { return null; }
  const identifier = /^[A-Za-z0-9_-]+$/;
  if (match[1]!.toLowerCase() === 'channel') {
    if (parts.length !== 2 || !(identifier.test(parts[0]!) || parts[0] === '@me') || !identifier.test(parts[1]!)) return null;
    return `/channels/${parts[0]}/${parts[1]}`;
  }
  if (parts.length !== 1) return null;
  const value = parts[0]!;
  const [code, host, ...extra] = value.split('@');
  if (!code || !identifier.test(code) || extra.length) return null;
  if (host !== undefined && (!host || !buildInstanceJoinUrl(host, value))) return null;
  return `/join/${value}`;
}

/** New shells normalize their event to backspace: for older hosted clients. */
export function useDeepLinkHandler(): void {
  const navigate = useNavigate();
  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;
    const offDeep = api.onDeepLink((input: string) => {
      const route = getDeepLinkRoute(input);
      if (route !== null) navigate(route);
    });
    const offInternal = api.onOpenInternalRoute((route: string) => { navigate(route); });
    return () => {
      if (typeof offDeep === 'function') offDeep(); // Older shells returned void.
      offInternal();
    };
  }, [navigate]);
}
