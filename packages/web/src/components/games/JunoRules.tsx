import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { JUNO_TURN_MS, type JunoCard as Card, type JunoView } from '@veyvox/shared/src/juno';
import { useFormatters } from '../../i18n/formatters';
import { JunoCard } from './JunoCard';
import { JUNO_ASSETS } from './junoAssets';

const SECTIONS = {
  start: 'juno.guide.sections.start', turn: 'juno.guide.sections.turn', special: 'juno.guide.sections.special',
  juno: 'juno.guide.sections.juno', memory: 'juno.guide.sections.memory', score: 'juno.guide.sections.score', table: 'juno.guide.sections.table',
} as const;
type Section = keyof typeof SECTIONS;
const SECTION_ORDER = Object.keys(SECTIONS) as Section[];
const SPECIALS = [
  { face: 'skip', color: 'sky', name: 'juno.faces.skip', effect: 'juno.guide.effects.skip' },
  { face: 'reverse', color: 'mint', name: 'juno.faces.reverse', effect: 'juno.guide.effects.reverse' },
  { face: 'draw2', color: 'amber', name: 'juno.faces.draw2', effect: 'juno.guide.effects.draw2' },
  { face: 'wild', color: null, name: 'juno.faces.wild', effect: 'juno.guide.effects.wild' },
  { face: 'draw4', color: null, name: 'juno.faces.draw4', effect: 'juno.guide.effects.draw4' },
] as const;
const DEALT = [['coral', '5'], ['amber', '3'], ['mint', '8'], ['sky', '9'], ['coral', '2'], ['mint', 'skip'], [null, 'wild']] as const;
function RuleCard({ face, color = null }: { face: Card['face']; color?: Card['color'] }) {
  return <JunoCard card={{ id: `guide-${color ?? 'wild'}-${face}`, face, color }} />;
}
interface Props {
  game: Pick<JunoView, 'phase' | 'supportsReports' | 'memoryEnabled' | 'supportsBots' | 'intoxicatedEnabled'> | null;
  supportsMemory?: boolean;
  supportsIntoxicated?: boolean;
}

/** Public teaching material only: examples never read the current hand or send moves. */
export function JunoRules({ game, supportsMemory, supportsIntoxicated }: Props) {
  const { t } = useTranslation(['voice', 'common']); const { formatNumber } = useFormatters();
  const id = useId(), details = useRef<HTMLDetailsElement>(null), trigger = useRef<HTMLElement>(null);
  const scroll = useRef<HTMLDivElement>(null), headings = useRef<Partial<Record<Section, HTMLHeadingElement | null>>>({});
  const [open, setOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>('start');
  const memory = supportsMemory === true || game?.memoryEnabled === true;
  const intoxicated = game?.intoxicatedEnabled === true || supportsIntoxicated === true && (!game || game.phase === 'lobby');
  const specialCards = memory || intoxicated;
  const sections = SECTION_ORDER.filter(section => section !== 'memory' || specialCards);
  const updateCurrentSection = useCallback(() => {
    const scroller = scroll.current;
    if (!scroller?.clientHeight) return;
    let current: Section = 'start';
    for (const section of SECTION_ORDER) {
      if (section === 'memory' && !specialCards) continue;
      const title = headings.current[section];
      if (title && title.offsetTop <= scroller.scrollTop + 24) current = section;
    }
    if (scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) current = 'table';
    setActiveSection(current);
  }, [specialCards]);
  useEffect(() => {
    const scroller = scroll.current;
    if (!open || !scroller) return;
    updateCurrentSection();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateCurrentSection);
    observer?.observe(scroller);
    const layout = scroller.querySelector('.juno-guide-layout');
    if (layout) observer?.observe(layout);
    window.addEventListener('resize', updateCurrentSection);
    return () => { observer?.disconnect(); window.removeEventListener('resize', updateCurrentSection); };
  }, [open, updateCurrentSection]);
  const close = () => { if (details.current) details.current.open = false; setOpen(false); trigger.current?.focus(); };
  const jump = (section: Section) => {
    const heading = headings.current[section];
    if (!heading || !scroll.current) return;
    scroll.current.scrollTo?.({ top: heading.offsetTop - 16, behavior: 'auto' });
    setActiveSection(section);
    updateCurrentSection();
    heading.focus({ preventScroll: true });
  };
  const heading = (section: Section) => <h3 id={`${id}-${section}`} tabIndex={-1} ref={element => { headings.current[section] = element; }}>{t(SECTIONS[section])}</h3>;
  return <details ref={details} className="juno-rules" onToggle={event => {
    setOpen(event.currentTarget.open); if (event.currentTarget.open) setActiveSection('start');
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <summary ref={trigger} className="juno-icon-button glass" title={t('juno.rules')}>
      <svg className="juno-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 4.1 1.9c-1 .7-1.6 1.1-1.6 2.6M12 16.5h.01" /></svg><span className="sr-only">{t('juno.rules')}</span>
    </summary>
    {open && <div className="juno-rules-content glass" role="region" aria-labelledby={`${id}-title`}>
      <div className="juno-guide-heading"><div><h2 id={`${id}-title`}>{t('juno.rules')}</h2><p>{t('juno.guide.subtitle')}</p></div>
        <button type="button" className="juno-icon-button juno-rules-close glass" aria-label={t('common:actions.close')} onClick={close}>
          <svg className="juno-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div ref={scroll} className="juno-guide-scroll" onScroll={updateCurrentSection}><div className="juno-guide-layout">
        <nav className="juno-guide-contents" aria-label={t('juno.guide.contents')}>
          {sections.map(section => <button type="button" key={section} onClick={() => jump(section)} aria-controls={`${id}-${section}`} aria-current={activeSection === section ? 'location' : undefined}>{t(SECTIONS[section])}</button>)}
        </nav>
        <div className="juno-guide-reading">
          <section aria-labelledby={`${id}-start`}>{heading('start')}
            <div className="juno-guide-deal" aria-hidden="true">{DEALT.map(([color, face], index) => <RuleCard key={index} face={face} color={color} />)}</div>
            <p className="juno-guide-lead">{t('juno.guide.start.goal')}</p><p>{t('juno.guide.start.deal')}</p><p>{t('juno.guide.start.setup')}</p>
          </section>
          <section aria-labelledby={`${id}-turn`}>{heading('turn')}<p>{t('juno.guide.turn.match')}</p>
            <div className="juno-guide-matches">
              <figure><RuleCard face="5" color="sky" /><figcaption>{t('juno.guide.examples.top')}</figcaption></figure>
              <svg className="juno-guide-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 12h18m-7-7 7 7-7 7" /></svg>
              <figure><RuleCard face="9" color="sky" /><figcaption>{t('juno.guide.examples.color')}</figcaption></figure>
              <figure><RuleCard face="5" color="coral" /><figcaption>{t('juno.guide.examples.number')}</figcaption></figure>
              <figure><RuleCard face="wild" /><figcaption>{t('juno.guide.examples.wild')}</figcaption></figure>
            </div>
            <p>{t('juno.guide.turn.draw')}</p><p>{t('juno.guide.turn.clock', { seconds: formatNumber(JUNO_TURN_MS / 1000) })}</p>
          </section>
          <section aria-labelledby={`${id}-special`}>{heading('special')}
            <div className="juno-guide-specials">{SPECIALS.map(card => <figure key={card.face}>
              <RuleCard face={card.face} color={card.color} /><figcaption><h4>{t(card.name)}</h4><p>{t(card.effect)}</p></figcaption>
            </figure>)}</div><p className="juno-guide-note">{t('juno.guide.effects.limits')}</p>
          </section>
          <section aria-labelledby={`${id}-juno`}>{heading('juno')}
            <div className="juno-guide-call"><img src={JUNO_ASSETS.logo} alt="" aria-hidden="true" /><p>{t('juno.guide.announce')}</p></div>
            {!game && <p className="juno-guide-note">{t('juno.guide.reporting.unknown')}</p>}
            {(game?.supportsReports || !game) && <div className="juno-guide-call"><img src={JUNO_ASSETS.hammerStill} alt="" aria-hidden="true" /><div><p>{t('juno.reportRules')}</p><p>{t('juno.guide.reporting.detail')}</p></div></div>}
            {(!game || !game.supportsReports) && <p>{t('juno.legacyJunoRules')}</p>}
          </section>
          {specialCards && <section aria-labelledby={`${id}-memory`}>{heading('memory')}
            {memory && <>
              {game && game.phase !== 'lobby' && !game.memoryEnabled && <p className="juno-guide-note">{t('juno.guide.memory.inactive')}</p>}
              <figure className="juno-guide-memory"><RuleCard face="memory" /><figcaption><h4>{t('juno.faces.memory')}</h4><p>{t('juno.guide.memory.intro')}</p></figcaption></figure>
              {(!game || game.phase === 'lobby') && <p className="juno-guide-note">{t('juno.guide.memory.lobby')}</p>}
              <p>{t('juno.guide.memory.play')}</p><p>{t('juno.guide.memory.miss')}</p><p>{t('juno.guide.memory.limits')}</p>
            </>}
            {intoxicated && <figure className="juno-guide-memory">
              <RuleCard face="intoxicated" /><figcaption><h4>{t('juno.intoxicated.title')}</h4><p>{t('juno.intoxicated.rules')}</p></figcaption>
            </figure>}
          </section>}
          <section aria-labelledby={`${id}-score`}>{heading('score')}<p>{t('juno.guide.score.ranking')}</p>
            <table className="juno-guide-xp"><thead><tr><th scope="col">{t('juno.rank')}</th><th scope="col">{t('juno.guide.score.award')}</th></tr></thead>
              <tbody>{[120, 80, 40, 20].map((xp, index) => <tr key={xp}><th scope="row">{formatNumber(index + 1)}</th><td>{t('juno.xpEarned', { xp: formatNumber(xp) })}</td></tr>)}</tbody>
            </table><p>{t('juno.guide.score.ties')}</p><p>{t('juno.guide.score.practice')}</p><p>{t('juno.guide.score.pending')}</p>
          </section>
          <section aria-labelledby={`${id}-table`}>{heading('table')}
            <p>{t('juno.guide.table.seats')}</p><p>{t('juno.guide.table.leave')}</p><p>{t('juno.guide.table.deck')}</p><p>{t('juno.guide.table.connection')}</p><p>{t('juno.guide.table.expiry')}</p>
          </section>
        </div>
      </div></div>
    </div>}
  </details>;
}
