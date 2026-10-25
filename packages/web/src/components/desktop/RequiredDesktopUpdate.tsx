import { useTranslation } from 'react-i18next';
import { useDesktopCompatibilityStore } from '../../stores/desktopCompatibilityStore';
import { canInstallRequiredUpdate, useUpdateStore } from '../../stores/updateStore';
import { formatters } from '../../i18n/formatters';

/** A root replacement, not a dismissible dialog above an active application. */
export function RequiredDesktopUpdate() {
  const { t } = useTranslation('desktop');
  const { phase, currentVersion, minimumVersion, error, retry } = useDesktopCompatibilityStore();
  const snapshot = useUpdateStore((s) => s.snapshot);
  const status = snapshot?.status;
  const percent = status?.phase === 'downloading' ? Math.max(0, Math.min(100, status.percent)) : null;
  const canInstall = minimumVersion !== null && canInstallRequiredUpdate(snapshot, minimumVersion);
  const button = 'rounded-xl px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary';
  const install = () => {
    const minimum = useDesktopCompatibilityStore.getState().minimumVersion;
    const updater = useUpdateStore.getState();
    if (minimum !== null && canInstallRequiredUpdate(updater.snapshot, minimum)) updater.install();
  };
  const check = () => { useUpdateStore.getState().checkNow(); retry(); };
  const openBrowser = () => {
    const origin = window.location.origin;
    // The existing desktop window-open handler opens HTTP(S) in the OS
    // browser; no new preload method and no peer-selected navigation target.
    window.open(origin, '_blank', 'noopener');
  };

  return (
    <main className="h-full overflow-y-auto bg-surface-base px-6 py-10 flex items-start justify-center">
      <section className="w-full max-w-xl my-auto py-6" aria-labelledby="desktop-update-heading">
        <img src="/icons/logo-mark.svg" alt="" className="h-9 w-9 mb-8" />
        <h1 id="desktop-update-heading" className="text-3xl font-semibold tracking-tight text-txt-primary">
          {t(phase === 'checking' ? 'compatibility.checkingTitle' : phase === 'failed' ? 'compatibility.failedTitle' : 'compatibility.title')}
        </h1>
        <p className="text-txt-secondary mt-3 leading-relaxed">{t('compatibility.body')}</p>
        <dl className="glass rounded-2xl mt-7 p-5 grid grid-cols-[1fr_auto] gap-x-6 gap-y-3 text-sm">
          <dt className="text-txt-secondary">{t('compatibility.installed')}</dt>
          <dd className="text-txt-primary font-medium break-all">{currentVersion ?? t('compatibility.unknown')}</dd>
          <dt className="text-txt-secondary">{t('compatibility.minimum')}</dt>
          <dd className="text-txt-primary font-medium break-all">{minimumVersion ?? t('compatibility.unknown')}</dd>
        </dl>
        <div className="mt-6 text-sm text-txt-secondary space-y-3" role="status" aria-live="polite">
          {phase === 'checking' && <p>{t('compatibility.checking')}</p>}
          {error && <p className="text-txt-warning">{t(error === 'version-unavailable' ? 'compatibility.versionUnavailable' : 'compatibility.checkFailed')}</p>}
          {!snapshot && <p>{t('compatibility.bridgeUnavailable')}</p>}
          {snapshot?.capability === 'manual' && <p>{t('compatibility.manual')}</p>}
          {snapshot?.capability === 'external' && <p>{t('compatibility.external')}</p>}
          {status?.phase === 'checking' && <p>{t('compatibility.updateChecking')}</p>}
          {status?.phase === 'failed' && <p className="text-txt-warning">{t('compatibility.updateFailed')}</p>}
          {(status?.phase === 'up-to-date' || (status?.phase === 'ready' && !canInstall)) && <p>{t('compatibility.insufficient')}</p>}
          {canInstall && <p>{t('compatibility.ready')}</p>}
          {percent !== null && (
            <div>
              <p className="mb-2">{t('compatibility.downloading', { percent: formatters.formatPercent(percent) })}</p>
              <div role="progressbar" aria-label={t('compatibility.progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
                className="h-1.5 rounded-full bg-surface-input overflow-hidden">
                <div className="h-full bg-accent-primary rounded-full" style={{ width: `${percent}%` }} />
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-3 mt-7">
          {canInstall && <button type="button" onClick={install} className={`${button} bg-accent-primary hover:bg-accent-primary-hover text-white`}>{t('compatibility.install')}</button>}
          <button type="button" onClick={() => useUpdateStore.getState().openDownloadPage()} className={`${button} glass hover:bg-interactive-hover text-txt-primary`}>{t('compatibility.download')}</button>
          <button type="button" onClick={check} className={`${button} glass hover:bg-interactive-hover text-txt-primary`}>{t('compatibility.retry')}</button>
          <button type="button" onClick={openBrowser} className={`${button} text-txt-link hover:bg-interactive-hover`}>{t('compatibility.browser')}</button>
        </div>
        <p className="mt-6 text-xs leading-relaxed text-txt-tertiary">{t('compatibility.preserved')}</p>
      </section>
    </main>
  );
}
