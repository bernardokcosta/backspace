import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useUIStore } from '../../../stores/uiStore';
import { describeError } from '../../../i18n/errors';
import { invalidateHomeInstanceInfo } from '../../../hooks/useHomeInstanceInfo';
import type { InstanceAdminSettings } from '@backspace/shared';

const INSTANCE_NAME_MAX_LENGTH = 32;

export function GeneralPanel() {
  const { t } = useTranslation(['admin', 'common']);
  const instanceSettings = useSettingsStore(s => s.instanceSettings);
  const updateInstanceSettings = useSettingsStore(s => s.updateInstanceSettings);
  const addToast = useUIStore(s => s.addToast);
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [gifKeyDirty, setGifKeyDirty] = useState(false);
  const [gifKeyDraft, setGifKeyDraft] = useState('');
  const seededName = useRef<string | null>(null);

  useEffect(() => {
    if (!instanceSettings) return;
    const next = instanceSettings.instanceName;
    if (name === next) { seededName.current = next; return; }
    // An external refresh must not overwrite the name or key being edited.
    if (gifKeyDirty || (name !== null && name !== seededName.current)) return;
    seededName.current = next;
    setName(next); setGifKeyDraft(''); setGifKeyDirty(false);
    // Read the draft only when settings change, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceSettings]);

  if (name === null || !instanceSettings) return <div className="text-sm text-txt-tertiary">{t('common:states.loadingSettings')}</div>;
  const hasChanges = gifKeyDirty || name !== instanceSettings.instanceName;
  const handleSave = async () => {
    setSaving(true); setSaveError('');
    try {
      const payload: Partial<InstanceAdminSettings> = { instanceName: name };
      if (gifKeyDirty) payload.gifApiKey = gifKeyDraft;
      await updateInstanceSettings(payload);
      invalidateHomeInstanceInfo();
      const saved = useSettingsStore.getState().instanceSettings;
      if (saved) { seededName.current = saved.instanceName; setName(saved.instanceName); }
      setGifKeyDirty(false); setGifKeyDraft('');
      addToast(t('common:states.settingsSaved'), 'success', 2000);
    } catch (err) { setSaveError(describeError(err)); }
    finally { setSaving(false); }
  };
  const handleReset = () => {
    seededName.current = instanceSettings.instanceName;
    setName(instanceSettings.instanceName); setGifKeyDirty(false); setGifKeyDraft(''); setSaveError('');
  };

  return (
    <form className="space-y-5" onSubmit={e => e.preventDefault()}>
      <h2 className="text-lg font-semibold text-txt-primary">{t('admin:general.title')}</h2>
      <div className="text-xs text-txt-tertiary">{t('admin:general.description')}</div>
      <div>
        <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider mb-1.5">{t('admin:general.instanceName.label')}</div>
        <p className="text-xs text-txt-tertiary mb-2">{t('admin:general.instanceName.description')}</p>
        <div className="rounded-lg bg-white/[0.02] p-3.5">
          <input type="text" value={name} onChange={e => setName(e.target.value.slice(0, INSTANCE_NAME_MAX_LENGTH))}
            placeholder={t('common:appName')} aria-label={t('admin:general.instanceName.label')} className="input-standard w-full" />
          <div className="text-[11px] text-txt-tertiary text-right mt-1">
            {t('admin:general.instanceName.counter', { length: name.length, max: INSTANCE_NAME_MAX_LENGTH })}
          </div>
        </div>
      </div>
      <div>
        <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider mb-1.5">{t('admin:general.gif.label')}</div>
        <p className="text-xs text-txt-tertiary mb-2">{t('admin:general.gif.description')}</p>
        <div className="rounded-lg bg-white/[0.02] p-3.5 space-y-2">
          <input type="password" value={gifKeyDirty ? gifKeyDraft : ''}
            onChange={e => { setGifKeyDraft(e.target.value); setGifKeyDirty(true); }}
            placeholder={instanceSettings.gifEnabled ? t('admin:general.gif.placeholderSaved') : t('admin:general.gif.placeholderKey')}
            className="input-standard w-full" autoComplete="off" />
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded ${instanceSettings.gifEnabled ? 'bg-status-online/15 text-status-online' : 'bg-white/5 text-txt-tertiary'}`}>
              {instanceSettings.gifEnabled ? t('admin:general.gif.enabled') : t('admin:general.gif.notConfigured')}
            </span>
            {instanceSettings.gifEnabled && !gifKeyDirty && (
              <button onClick={() => { setGifKeyDraft(''); setGifKeyDirty(true); }} className="text-[11px] text-txt-tertiary hover:text-txt-danger transition-colors">
                {t('admin:general.gif.clearKey')}
              </button>
            )}
          </div>
        </div>
      </div>
      {saveError && <div className="p-2 bg-accent-rose/10 border border-accent-rose/30 rounded text-txt-danger text-sm">{saveError}</div>}
      {hasChanges && (
        <div className="sticky bottom-0 z-10 pointer-events-none">
          <div className="flex justify-center pt-3 pb-1">
            <div className="glass-bubble rounded-full px-4 py-2 flex items-center gap-2 animate-slide-up pointer-events-auto">
              <button onClick={handleReset} className="px-3 py-1 text-sm text-txt-tertiary hover:text-txt-secondary transition-colors">{t('common:actions.reset')}</button>
              <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 bg-accent-primary hover:bg-accent-primary/80 text-white text-sm font-medium rounded-full transition-colors disabled:opacity-50">
                {saving ? t('common:states.saving') : t('common:actions.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
