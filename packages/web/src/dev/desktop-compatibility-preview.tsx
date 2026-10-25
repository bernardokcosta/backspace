// Presentation-only workbench. No bridge, policy/API requests, session or media.
// Vite's production entry list does not include this HTML/module.
import { createRoot } from 'react-dom/client';
import { RequiredDesktopUpdate } from '../components/desktop/RequiredDesktopUpdate';
import { useDesktopCompatibilityStore } from '../stores/desktopCompatibilityStore';
import { useUpdateStore } from '../stores/updateStore';
import i18n, { initI18n } from '../i18n';
import { initializeInterfaceScale } from '../platform/interfaceScale';
import '../styles/globals.css';

async function main() {
  if (!import.meta.env.DEV) return;
  const scene = new URLSearchParams(location.search).get('scene');
  const status: DesktopUpdateStatus = scene === 'ready' ? { phase: 'ready', version: '1.15.1' }
    : scene === 'failed' ? { phase: 'failed', version: '1.15.1', message: 'fixture' }
    : { phase: 'downloading', version: '1.15.1', percent: 42, bytesPerSecond: 1024 };
  useDesktopCompatibilityStore.setState({ phase: 'required', currentVersion: '1.15.0', minimumVersion: '1.15.1', error: null, retry: () => {} });
  useUpdateStore.setState({ snapshot: { capability: scene === 'manual' ? 'manual' : scene === 'external' ? 'external' : 'auto',
    status: scene === 'manual' || scene === 'external' ? { phase: 'idle' } : status, dismissedVersion: '1.15.1' },
    checkNow: () => {}, install: () => {}, openDownloadPage: () => {},
  });
  initializeInterfaceScale();
  await initI18n(); await i18n.loadNamespaces('desktop');
  const root = document.getElementById('root');
  if (root) createRoot(root).render(<div className="h-screen"><RequiredDesktopUpdate /></div>);
}
void main();
