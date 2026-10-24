import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_SOUNDBOARD_BYTES, SOUNDBOARD_SAMPLE_RATE } from '@backspace/shared/src/soundboard';
import { AudioManager } from '../../audio/AudioManager';
import { audioBase64, encodeSoundboardClip, soundboardSelectionSamples } from '../../utils/soundboardAudio';
import { getApiForOrigin } from '../../utils/crossStoreResolvers';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';

const MIN_SELECTION = 0.1;

export function SoundboardUpload({ origin, spaceId, maxDuration, onDone, onCancel }: {
  origin: string; spaceId: string; maxDuration: number; onDone: () => void; onCancel: () => void;
}) {
  const { t } = useTranslation(['voice', 'common']);
  const selectionId = useId();
  const { formatNumber, formatBytes, formatDuration } = useFormatters();
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [name, setName] = useState(''); const [emoji, setEmoji] = useState('🔊');
  const [start, setStart] = useState(0); const [end, setEnd] = useState(0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const generation = useRef(0);
  // Drag-to-select anchor in seconds; null when not dragging.
  const dragAnchor = useRef<number | null>(null);
  const stop = () => { try { source.current?.stop(); } catch { /* Already ended. */ } source.current?.disconnect(); source.current = null; setPreviewing(false); };
  useEffect(() => () => { generation.current++; try { source.current?.stop(); } catch { /* Already ended. */ } source.current?.disconnect(); }, []);
  const peaks = useMemo(() => {
    if (!buffer) return [];
    const data = buffer.getChannelData(0);
    return Array.from({ length: 80 }, (_, i) => {
      let peak = 0;
      const from = Math.floor(i * data.length / 80); const to = Math.floor((i + 1) * data.length / 80);
      const stride = Math.max(1, Math.floor((to - from) / 100));
      for (let j = from; j < to; j += stride) peak = Math.max(peak, Math.abs(data[j] ?? 0));
      return peak;
    });
  }, [buffer]);
  const samples = buffer ? soundboardSelectionSamples(buffer.duration, start, end) : null;
  const duration = samples === null ? end - start : samples / SOUNDBOARD_SAMPLE_RATE;
  const overCap = samples !== null && duration > maxDuration;
  const valid = samples !== null && !overCap
    && samples * 2 + 44 <= MAX_SOUNDBOARD_BYTES;

  const pick = async (file?: File) => {
    if (!file) return;
    stop(); const run = ++generation.current; setError(''); setBuffer(null);
    if (file.size > MAX_SOUNDBOARD_BYTES) { setError(t('voice:soundboard.fileTooLarge', { max: formatBytes(MAX_SOUNDBOARD_BYTES) })); return; }
    setBusy(true);
    try {
      const decoded = await AudioManager.getInstance().ensureContext().decodeAudioData(await file.arrayBuffer());
      if (run !== generation.current) return;
      if (!Number.isFinite(decoded.duration) || decoded.duration < 0.1 || decoded.length * decoded.numberOfChannels > 50_000_000) throw new Error('Audio too large');
      setBuffer(decoded); setName(file.name.replace(/\.[^.]+$/, '').slice(0, 48)); setStart(0);
      setEnd(Math.min(decoded.duration, maxDuration));
    } catch { if (run === generation.current) setError(t('voice:soundboard.decodeFailed')); }
    finally { if (run === generation.current) setBusy(false); }
  };
  const preview = async () => {
    if (previewing) { stop(); return; }
    if (!buffer || !valid) return;
    const run = generation.current;
    try {
      const manager = AudioManager.getInstance(); await manager.resumeContext();
      if (run !== generation.current) return;
      const context = manager.ensureContext(); const node = context.createBufferSource();
      node.buffer = buffer; node.connect(manager.getMasterOutput()); source.current = node;
      node.onended = () => { if (source.current === node) { node.disconnect(); source.current = null; setPreviewing(false); } };
      node.start(0, start, duration); setPreviewing(true);
    } catch { setError(t('voice:soundboard.playFailed')); }
  };
  const save = async () => {
    if (!buffer || !valid || !name.trim() || !emoji.trim() || busy) return;
    stop(); setBusy(true); setError('');
    try {
      const bytes = await encodeSoundboardClip(buffer, start, end);
      await getApiForOrigin(origin).soundboard.upload(spaceId, { name: name.trim(), emoji: emoji.trim(), audio: audioBase64(bytes) });
      onDone();
    } catch (cause) { setError(describeError(cause)); }
    finally { setBusy(false); }
  };
  const resetSelection = () => {
    if (!buffer || busy) return;
    stop(); setStart(0); setEnd(Math.min(buffer.duration, maxDuration));
  };
  const fullEnd = buffer === null ? 0 : Math.min(buffer.duration, maxDuration);
  // Full only when the selection IS the default window: start at zero, end at
  // the capped length, and within the cap. An over-long drag contains the
  // window but is not it — reset must stay visible so the invalid selection
  // is escapable without typing numbers.
  const isFullSelection = buffer !== null && start <= 0 && end >= fullEnd - 1e-9 && duration <= maxDuration + 1e-9;
  const timeAt = (clientX: number, el: HTMLDivElement): number => {
    if (!buffer) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    return ratio * buffer.duration;
  };
  const applyDrag = (anchor: number, t: number) => {
    if (!buffer) return;
    const total = buffer.duration;
    const s = Math.min(Math.max(0, Math.min(anchor, t)), total);
    const e = Math.min(Math.max(0, Math.max(anchor, t)), total);
    if (e - s < MIN_SELECTION) return;
    stop();
    setStart(s);
    setEnd(e);
  };
  const onWavePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!buffer || busy) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    stop();
    dragAnchor.current = timeAt(e.clientX, e.currentTarget);
  };
  const onWavePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!buffer || busy || dragAnchor.current === null) return;
    applyDrag(dragAnchor.current, timeAt(e.clientX, e.currentTarget));
  };
  const onWavePointerUp = () => { dragAnchor.current = null; };
  return <section className="rounded-xl bg-surface-channel p-4 space-y-4">
    <h3 className="font-semibold text-txt-primary">{t('voice:soundboard.add')}</h3>
    <label className="block text-sm text-txt-secondary">{t('voice:soundboard.chooseFile')}
      <input type="file" accept="audio/*" disabled={busy} onChange={e => void pick(e.target.files?.[0])} className="block w-full mt-2 text-sm file:rounded-lg file:border-0 file:bg-accent-primary/20 file:text-accent-primary file:px-3 file:py-2" />
    </label>
    <p className="text-xs text-txt-tertiary">{t('voice:soundboard.uploadHint', { max: formatBytes(MAX_SOUNDBOARD_BYTES) })}</p>
    {buffer && <>
      <div className="flex gap-3">
        <label className="text-sm text-txt-secondary w-20">{t('voice:soundboard.emoji')}<input value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={16} disabled={busy} className="input-standard w-full mt-1 text-center" /></label>
        <label className="text-sm text-txt-secondary flex-1 min-w-0">{t('voice:soundboard.name')}<input value={name} onChange={e => setName(e.target.value)} maxLength={48} disabled={busy} className="input-standard w-full mt-1" /></label>
      </div>
      <div
        className="h-20 flex items-center gap-0.5 rounded-lg bg-surface-input px-2 overflow-hidden cursor-ew-resize touch-none select-none"
        role="group" aria-label={t('voice:soundboard.dragHint')}
        title={t('voice:soundboard.dragHint')}
        onPointerDown={onWavePointerDown} onPointerMove={onWavePointerMove} onPointerUp={onWavePointerUp} onPointerCancel={onWavePointerUp}
      >
        {peaks.map((peak, i) => <div key={i} className={`flex-1 rounded-full pointer-events-none ${i / 80 * buffer.duration >= start && i / 80 * buffer.duration <= end ? 'bg-accent-primary' : 'bg-white/10'}`} style={{ height: `${Math.max(4, peak * 100)}%` }} />)}
      </div>
      <div className="flex items-center justify-between text-xs text-txt-tertiary">
        <span>{formatDuration(start)}</span>
        <span>{t('voice:soundboard.dragHint')}</span>
        <span>{formatDuration(buffer.duration)}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="text-sm text-txt-secondary"><label htmlFor={`${selectionId}-start`}>{t('voice:soundboard.start')}</label><input id={`${selectionId}-start`} type="number" step="0.01" min={0} max={end - 0.1} value={start} disabled={busy} onChange={e => { stop(); setStart(Number(e.target.value)); }} className="input-standard w-full mt-1" />
          <input type="range" min={0} max={buffer.duration} step="0.01" value={start} disabled={busy} onChange={e => { stop(); setStart(Math.min(Number(e.target.value), end - 0.1)); }} aria-label={t('voice:soundboard.start')} className="w-full mt-2 accent-accent-primary" />
        </div>
        <div className="text-sm text-txt-secondary"><label htmlFor={`${selectionId}-end`}>{t('voice:soundboard.end')}</label><input id={`${selectionId}-end`} type="number" step="0.01" min={start + 0.1} max={buffer.duration} value={end} disabled={busy} onChange={e => { stop(); setEnd(Number(e.target.value)); }} className="input-standard w-full mt-1" />
          <input type="range" min={0} max={buffer.duration} step="0.01" value={end} disabled={busy} onChange={e => { stop(); setEnd(Math.max(Number(e.target.value), start + 0.1)); }} aria-label={t('voice:soundboard.end')} className="w-full mt-2 accent-accent-primary" />
        </div>
      </div>
      <p className={`text-sm ${valid ? 'text-txt-tertiary' : 'text-accent-rose'}`}>{t('voice:soundboard.selection', { duration: formatNumber(Math.round(duration * 100) / 100) })}{` · ${t('voice:soundboard.limit', { max: formatNumber(maxDuration) })}`}{overCap ? ` · ${t('voice:soundboard.overLimit')}` : ''}{!isFullSelection && !busy && (
        <button type="button" onClick={resetSelection} className="ml-2 underline underline-offset-2 hover:text-txt-secondary">{t('voice:soundboard.resetSelection')}</button>
      )}</p>
    </>}
    {error && <p role="alert" className="text-sm text-accent-rose">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" disabled={!valid || busy} onClick={() => void preview()} className="px-3 py-2 rounded-lg text-sm bg-surface-input text-txt-secondary disabled:opacity-40">{previewing ? t('voice:soundboard.stop') : t('voice:soundboard.preview')}</button>
      <button type="button" disabled={busy} onClick={onCancel} className="px-3 py-2 rounded-lg text-sm text-txt-secondary">{t('common:actions.cancel')}</button>
      <button type="button" disabled={!valid || !name.trim() || !emoji.trim() || busy} onClick={() => void save()} className="px-4 py-2 rounded-lg text-sm bg-accent-primary text-white disabled:opacity-40">{busy ? t('common:states.loading') : t('voice:soundboard.add')}</button>
    </div>
  </section>;
}
