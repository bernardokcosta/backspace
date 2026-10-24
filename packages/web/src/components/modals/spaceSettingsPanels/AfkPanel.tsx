import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AFK_TIMEOUT_OPTIONS } from '@backspace/shared/src/constants';
import { useSpaceStore } from '../../../stores/spaceStore';
import { describeError } from '../../../i18n/errors';

/**
 * AFK voice channel settings: which voice channel idle members move to, and
 * after how long. An empty channel selection disables the feature. Each
 * connected client enforces the move on itself (see useAfkVoiceMove); the
 * server only stores and validates the configuration.
 */
export function AfkPanel({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation(['spaces', 'common']);
  const space = useSpaceStore((s) => s.spaces.find((sp) => sp.id === spaceId));
  const channels = useSpaceStore((s) => s.channels);
  const updateSpace = useSpaceStore((s) => s.updateSpace);
  const [channelId, setChannelId] = useState<string>('');
  const [timeout, setTimeout] = useState<number>(300);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (space && !dirty) {
      setChannelId(space.afkChannelId ?? '');
      setTimeout(typeof space.afkTimeoutSeconds === 'number' ? space.afkTimeoutSeconds : 300);
    }
  }, [space, dirty]);

  if (!space) return null;
  const voiceChannels = channels.filter((c) => c.spaceId === spaceId && c.type === 'voice');

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    setError('');
    try {
      await updateSpace(spaceId, { afkChannelId: channelId === '' ? null : channelId, afkTimeoutSeconds: timeout });
      setDirty(false);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-txt-primary">{t('spaces:settings.afk.title')}</h2>
      <div className="text-sm text-txt-secondary">
        <label htmlFor="afk-channel">{t('spaces:settings.afk.channelLabel')}</label>
        <select
          id="afk-channel"
          disabled={saving}
          value={channelId}
          onChange={(e) => { setChannelId(e.target.value); setDirty(true); }}
          className="input-standard w-full mt-2"
        >
          <option value="">{t('spaces:settings.afk.disabled')}</option>
          {voiceChannels.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="text-sm text-txt-secondary">
        <label htmlFor="afk-timeout">{t('spaces:settings.afk.timeoutLabel')}</label>
        <select
          id="afk-timeout"
          disabled={saving || channelId === ''}
          value={timeout}
          onChange={(e) => { setTimeout(Number(e.target.value)); setDirty(true); }}
          className="input-standard w-full mt-2"
        >
          {AFK_TIMEOUT_OPTIONS.map((s) => (
            <option key={s} value={s}>{Math.round(s / 60)} {t('spaces:settings.afk.minutes')}</option>
          ))}
        </select>
      </div>
      <p className="text-xs text-txt-tertiary">{t('spaces:settings.afk.hint')}</p>
      {error && <p role="alert" className="text-sm text-accent-rose">{error}</p>}
      {dirty && (
        <div className="flex gap-3">
          <button disabled={saving} onClick={() => void save()} className="bg-accent-primary text-white px-4 py-2 rounded-lg disabled:opacity-40">
            {saving ? t('common:states.loading') : t('common:actions.save')}
          </button>
        </div>
      )}
    </div>
  );
}
