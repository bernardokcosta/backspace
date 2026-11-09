export function isElectron(): boolean {
  return getElectronAPI() !== null;
}

export function isElectronMac(): boolean {
  return getElectronAPI()?.platform === 'darwin';
}

export function getElectronAPI(): VeyvoxElectronAPI | null {
  return typeof window === 'undefined' ? null : window.veyvox ?? window.backspace ?? null;
}
