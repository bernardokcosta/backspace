import { useEffect, useId, useRef, type KeyboardEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { availableLanguages, supportedLanguages, type SupportedLanguage } from '../../i18n';
import { useFormatters } from '../../i18n/formatters';
import { useJunoPreferences } from '../../stores/junoPreferences';
import { useJunoLanguage } from './JunoLocale';
import { useJunoMusicState } from '../../audio/junoMusic';
import { JUNO_DUBBINGS, type JunoDubbingLanguage } from './junoAssets';

export function JunoSettings({ onClose, trigger }: { onClose: () => void; trigger: RefObject<HTMLButtonElement | null> }) {
  const { t } = useTranslation(['voice', 'common']); const { formatPercent } = useFormatters();
  const p = useJunoPreferences(); const music = useJunoMusicState();
  const id = useId(), dialog = useRef<HTMLDivElement>(null);
  const { language: gameLanguage, dir: gameDir } = useJunoLanguage();
  useEffect(() => {
    const previous = trigger.current;
    dialog.current?.querySelector('select')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [trigger]);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const fields = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)');
    const first = fields?.[0], last = fields?.[fields.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  return <Modal isOpen onClose={onClose} maxWidth="max-w-md" mobileStyle="sheet">
    <div ref={dialog} className="juno-settings" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} lang={gameLanguage} dir={gameDir} onKeyDown={keyDown}>
      <div className="juno-settings-heading"><h2 id={`${id}-title`}>{t('juno.settings.title')}</h2>
        <button type="button" onClick={onClose} className="juno-settings-close" aria-label={t('common:actions.close')}>×</button></div>
      <fieldset><legend>{t('juno.settings.languageGroup')}</legend>
        <label htmlFor={`${id}-language`}>{t('juno.settings.language')}</label>
        <select id={`${id}-language`} className="input-standard" value={p.language} onChange={event => p.setLanguage(event.target.value as 'auto' | SupportedLanguage)}>
          <option value="auto">{t('juno.settings.automatic')}</option>
          {availableLanguages.map(language => <option key={language.code} value={language.code} lang={language.code}>{language.nativeName}</option>)}
        </select>
        <label htmlFor={`${id}-dubbing`}>{t('juno.settings.dubbing')}</label>
        <select id={`${id}-dubbing`} className="input-standard" value={p.dubbingLanguage} onChange={event => p.setDubbingLanguage(event.target.value as 'auto' | JunoDubbingLanguage)}>
          <option value="auto">{t('juno.settings.automaticDubbing')}</option>
          {(Object.keys(JUNO_DUBBINGS) as JunoDubbingLanguage[]).map(language => <option key={language} value={language} lang={JUNO_DUBBINGS[language].languageCode}>{supportedLanguages.find(entry => entry.code === JUNO_DUBBINGS[language].languageCode)?.nativeName}</option>)}
        </select>
      </fieldset>
      <fieldset><legend>{t('juno.settings.audioGroup')}</legend>
        <div className="juno-settings-volume-label"><label htmlFor={`${id}-effects`}>{t('juno.settings.effects')}</label><output htmlFor={`${id}-effects`}>{formatPercent(p.effectsVolume)}</output></div>
        <input id={`${id}-effects`} type="range" min={0} max={100} step={1} value={p.effectsVolume} aria-valuetext={formatPercent(p.effectsVolume)} onChange={event => p.setEffectsVolume(Number(event.target.value))} />
        <div className="juno-settings-volume-label"><label htmlFor={`${id}-music`}>{t('juno.settings.music')}</label><output htmlFor={`${id}-music`}>{formatPercent(p.musicVolume)}</output></div>
        <input id={`${id}-music`} type="range" min={0} max={100} step={1} value={p.musicVolume} aria-valuetext={formatPercent(p.musicVolume)} onChange={event => p.setMusicVolume(Number(event.target.value))} />
        {(music.status === 'blocked' || music.status === 'error') && <div className="juno-settings-playback" role="status">
          <p>{t(music.status === 'blocked' ? 'juno.settings.autoplayBlocked' : 'juno.settings.musicFailed')}</p>
          <button type="button" className="juno-settings-play" onClick={() => music.retry?.()}>{t('juno.settings.playMusic')}</button>
        </div>}
      </fieldset>
    </div>
  </Modal>;
}
