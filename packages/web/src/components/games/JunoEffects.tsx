import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { JunoMove } from '@backspace/shared/src/juno';
import { JunoCard } from './JunoCard';
import { JUNO_ASSETS } from './junoAssets';
import { layoutPixels } from '../../platform/interfaceScale';

/** Only new confirmed moves animate. Mounting, polls and reconnects never replay. */
export function JunoEffects({ move, position, name }: { move: JunoMove | null; position: string; name: string }) {
  const { t } = useTranslation('voice');
  const layer = useRef<HTMLDivElement>(null);
  const seen = useRef(move?.id);
  const [cue, setCue] = useState<{ move: JunoMove; position: string; name: string; fromX: number; fromY: number } | null>(null);
  const id = move?.id;
  useEffect(() => {
    if (!id || id === seen.current) return;
    seen.current = id;
    if (!move || !['play', 'draw', 'announce', 'timeout'].includes(move.type)) return;
    const box = layer.current?.getBoundingClientRect();
    const avatar = layer.current?.parentElement?.querySelector(`[data-seat="${position}"] .juno-avatar-frame`)?.getBoundingClientRect();
    setCue({ move, position, name, fromX: box && avatar ? layoutPixels(avatar.x + avatar.width / 2 - box.x - box.width / 2) : 0,
      fromY: box && avatar ? layoutPixels(avatar.y + avatar.height / 2 - box.y - box.height * .4) : 0 });
  }, [id, move, position, name]);
  useEffect(() => {
    if (!cue) return;
    const timeout = window.setTimeout(() => setCue(null), 1400);
    return () => window.clearTimeout(timeout);
  }, [cue]);
  const announcement = cue?.move.type === 'announce' || cue?.move.announced;
  const special = cue?.move.card?.face;
  const symbol = special === 'draw2' ? '+2' : special === 'draw4' ? '+4' : special === 'reverse' ? '↺' : special === 'skip' ? '⊘' : null;
  return <div ref={layer} className="juno-effects" aria-hidden="true" style={cue ? { '--from-x': `${cue.fromX}px`, '--from-y': `${cue.fromY}px` } as CSSProperties : undefined}>{cue && <>
    {cue.move.card && <div key={`${cue.move.id}:card`} className="juno-effect-card" data-from={cue.position}><JunoCard card={cue.move.card} /></div>}
    {!cue.move.card && !announcement && <div key={`${cue.move.id}:draw`} className="juno-effect-draw" data-from={cue.position}><JunoCard back /></div>}
    {symbol && <strong key={`${cue.move.id}:special`} className="juno-effect-special">{symbol}</strong>}
    {announcement && <div key={`${cue.move.id}:juno`} className="juno-effect-announce" data-from={cue.position}>
      <img src={JUNO_ASSETS.logo} alt="" /><span>{t('juno.announcedBy', { name: cue.name })}</span>
    </div>}
  </>}</div>;
}
