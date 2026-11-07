import { useId, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { JUNO_COLORS, canPlayJuno, type JunoCard as Card, type JunoColor, type JunoPerson } from '@backspace/shared/src/juno';
import { useJunoStore } from '../../stores/junoStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useSharedSecondBeat } from '../../hooks/useSharedSecondBeat';
import { useFormatters } from '../../i18n/formatters';
import { JunoCard, JUNO_PALETTE } from './JunoCard';
import { JunoPlayerBadge } from './JunoPlayerBadge';
import { JUNO_ASSETS } from './junoAssets';
import { junoSeats } from './junoSeats';
import { JunoEffects } from './JunoEffects';

const COLOR_KEYS = { coral: 'juno.colors.coral', amber: 'juno.colors.amber', mint: 'juno.colors.mint', sky: 'juno.colors.sky' } as const;
const FACE_KEYS = { skip: 'juno.faces.skip', reverse: 'juno.faces.reverse', draw2: 'juno.faces.draw2', wild: 'juno.faces.wild', draw4: 'juno.faces.draw4', memory: 'juno.faces.memory' } as const;
export function JunoMatch() {
  const { t } = useTranslation(['voice', 'common']); const { formatNumber, formatDuration } = useFormatters();
  const { snapshot, target, connected, pending, stale, command, observedAt } = useJunoStore();
  const spaceId = useSpaceStore(s => target ? s.spaceChannelIndex.get(target.channelId)?.spaceId ?? '' : '');
  const now = useSharedSecondBeat();
  const [colorChoice, setColorChoice] = useState<{ card: Card; revision: number; gameId: string } | null>(null);
  const [announceRevision, setAnnounceRevision] = useState<number | null>(null);
  const colorTrigger = useRef<HTMLButtonElement | null>(null);
  const reportDescriptionId = useId();
  const game = snapshot?.game;
  if (!game || game.phase !== 'playing') return null;
  const revision = snapshot.revision; const selfId = target?.selfId;
  const disabled = !connected || pending || stale; const myTurn = game.currentPlayerId === selfId;
  const isPlayer = game.players.some(p => p.userId === selfId);
  const blind = isPlayer && game.memoryCurse?.targetUserId === selfId;
  const handCount = blind ? game.maskedHand?.length ?? 0 : game.hand.length;
  const current = game.players.find(p => p.userId === game.currentPlayerId);
  const seats = junoSeats(game.players, selfId);
  const self = game.players.find(p => p.userId === selfId);
  const sayJuno = game.supportsAnnounce ? self?.announced === true : announceRevision === revision;
  const next = game.players[(game.players.findIndex(p => p.userId === game.currentPlayerId) + game.direction + game.players.length) % game.players.length];
  const chosen = colorChoice?.revision === revision && colorChoice.gameId === game.id && myTurn ? colorChoice.card : null;
  const seconds = Math.ceil(Math.max(0, game.remainingMs - Math.max(0, now - observedAt)) / 1000);
  const faceLabel = (card: Card) => /^\d$/.test(card.face) ? formatNumber(Number(card.face)) : t(FACE_KEYS[card.face as keyof typeof FACE_KEYS]);
  const cardLabel = (card: Card) => t('juno.card', { color: card.color ? t(COLOR_KEYS[card.color]) : '', face: faceLabel(card) });
  const canPlay = (card: Card) => myTurn && !!game.topCard && !!game.color
    && (!game.drawnCardId || game.drawnCardId === card.id) && canPlayJuno(card, game.hand, game.topCard, game.color);
  const play = (card: Card, color?: JunoColor) => {
    void command({ type: 'play', cardId: card.id, ...(color ? { color } : {}), announce: sayJuno }); setColorChoice(null);
  };
  const cancelColor = () => { setColorChoice(null); colorTrigger.current?.focus(); };
  const playerName = (person: JunoPerson | undefined) => person?.computer ? t('juno.botName', { number: person.computer }) : person?.nickname ?? person?.name ?? '';
  const seat = (position: keyof typeof seats) => {
    const person = seats[position];
    const side = position === 'left' || position === 'right';
    const visibleCards = Math.min(10, person?.cardCount ?? 0);
    const opportunity = game.supportsReports && isPlayer && person?.userId !== selfId && person?.cardCount === 1 && !person.announced
      ? game.reportOpportunities?.find(window => window.targetUserId === person?.userId) : undefined;
    const reportSeconds = Math.ceil(Math.max(0, (opportunity?.remainingMs ?? 0) - Math.max(0, now - observedAt)) / 1000);
    const reportControl = game.supportsReports && person && <div className="juno-report-anchor">{opportunity && <><button type="button" className="juno-report" aria-label={t('juno.reportPlayer', { name: playerName(person) })}
      aria-describedby={`${reportDescriptionId}-${position}`} title={t('juno.reportPlayer', { name: playerName(person) })} disabled={disabled || reportSeconds <= 0}
      onClick={() => { if (opportunity.remainingMs > Math.max(0, Date.now() - observedAt)) void command({ type: 'report', targetUserId: opportunity.targetUserId, opportunityId: opportunity.id }); }}>
      <img src={JUNO_ASSETS.hammerStill} alt="" aria-hidden="true" draggable={false} />
    </button><span id={`${reportDescriptionId}-${position}`} className="sr-only">{t('juno.reportTime', { seconds: formatNumber(reportSeconds) })}</span></>}</div>;
    return <div key={position} data-seat={position} className={`juno-seat juno-seat-${position}${person && game.memoryCurse?.targetUserId === person.userId ? ' juno-seat-memory' : ''}`}>
      {person ? <>
        {game.memoryCurse?.targetUserId === person.userId && <span className="sr-only">{t('juno.memory.affected', { name: playerName(person) })}</span>}
        <div className="juno-player-controls"><JunoPlayerBadge person={person} origin={target?.origin ?? ''} spaceId={spaceId} self={person.userId === selfId}
          active={person.userId === game.currentPlayerId} next={person.userId === next?.userId} detail={t('juno.cardCount', { count: person.cardCount })} reportControl={reportControl} />
        </div>
        {person.userId !== selfId && <div className={`juno-opponent-cards${side ? ' juno-side-hand' : ''}`} aria-hidden="true">
          {Array.from({ length: visibleCards }, (_, i) => side
            ? <span key={i} className="juno-side-card" style={{ '--juno-card-tilt': `${(i - 3) * 3}deg` } as CSSProperties}><JunoCard back /></span>
            : <JunoCard back key={i} />)}
        </div>}
        {person.announced && <span className="juno-called">{t('juno.name')}</span>}
      </> : <span className="juno-empty-position" aria-label={t('juno.emptySeat')} />}
    </div>;
  };
  const movePlayer = game.players.find(p => p.userId === game.lastMove?.userId);
  const moveTarget = game.players.find(p => p.userId === game.lastMove?.targetUserId);
  const effectPlayer = game.lastMove?.type === 'report' ? moveTarget : movePlayer;
  const movePosition = Object.entries(seats).find(([, person]) => person?.userId === effectPlayer?.userId)?.[0] ?? 'top';
  return <div className={`juno-match${game.supportsReports ? ' juno-reports' : ''}${myTurn ? ' juno-my-turn' : ''}${blind ? ' juno-memory-active' : ''}`}>
    <JunoEffects move={game.lastMove} position={movePosition} name={playerName(effectPlayer)} />
    <div className="juno-arena">
      <img className="juno-orbit" src={JUNO_ASSETS.orbit} alt="" aria-hidden="true" />
      {seat('top')}{seat('left')}{seat('right')}
      <div className="juno-center"><div className="juno-piles">
        <div className="juno-pile"><div className={`juno-discard${blind ? ' juno-memory-pile' : ''}`} aria-label={blind ? t('juno.memory.hiddenPile') : game.topCard ? cardLabel(game.topCard) : undefined}>
          {blind ? <span className="juno-hidden-face" aria-hidden="true" /> : <JunoCard card={game.topCard ?? undefined} />}
        </div><span>{t('juno.discardPile')}</span></div>
        <div className="juno-pile">{isPlayer ? <button type="button" className="juno-draw-art" aria-label={t('juno.drawPile')}
          disabled={disabled || !myTurn || blind || !!game.drawnCardId} onClick={() => void command({ type: 'draw' })}><JunoCard back /></button>
          : <div className="juno-draw-art"><JunoCard back /></div>}<span>{t('juno.drawPile')}</span></div>
      </div><div className="juno-table-info">
        {blind ? <span className="juno-memory-indicator" title={t('juno.memory.title')} aria-label={t('juno.memory.title')} />
          : game.color && <span className="juno-active-color" title={t('juno.activeColor', { color: t(COLOR_KEYS[game.color]) })} aria-label={t('juno.activeColor', { color: t(COLOR_KEYS[game.color]) })}><i style={{ backgroundColor: JUNO_PALETTE[game.color] }} /></span>}
        <span className="juno-direction" title={game.direction === 1 ? t('juno.clockwise') : t('juno.counterclockwise')}><b aria-hidden="true">{game.direction === 1 ? '↻' : '↺'}</b></span>
        <span className="juno-timer" aria-label={t('juno.turnTime')}>{formatDuration(seconds)}</span>
      </div>{blind && <p id={`${reportDescriptionId}-memory`} className="juno-memory-message" role="status">{t('juno.memory.instruction')}</p>}</div>
    </div>
    <div className="sr-only" role="status" aria-live="polite">{myTurn ? t('juno.yourTurn') : t('juno.theirTurn', { name: current?.name ?? '' })}</div>
    {isPlayer ? <>
      <div className="juno-hand" role="group" aria-label={t('juno.yourHand')} aria-describedby={blind ? `${reportDescriptionId}-memory` : undefined}>
        {blind ? (game.maskedHand ?? []).map((slot, index) => <button key={slot.id} type="button" className="juno-hand-card juno-hidden-card"
          disabled={disabled || !myTurn} aria-label={t('juno.memory.hiddenCard', { number: formatNumber(index + 1) })} title={t('juno.memory.hiddenCard', { number: formatNumber(index + 1) })}
          onClick={() => void command({ type: 'play', cardId: slot.id, announce: sayJuno })}><span className="juno-hidden-face" aria-hidden="true" /></button>)
          : game.hand.map(card => <button key={card.id} type="button" className={`juno-hand-card${canPlay(card) ? ' juno-card-legal' : ''}`}
          disabled={disabled || !canPlay(card)} aria-label={t('juno.playCard', { card: cardLabel(card) })} title={cardLabel(card)}
          onClick={event => { if (card.color || card.face === 'memory') play(card); else { colorTrigger.current = event.currentTarget; setColorChoice({ card, revision, gameId: game.id }); } }}><JunoCard card={card} /></button>)}
      </div>
      {chosen && !blind && <fieldset className="juno-color-picker glass" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); cancelColor(); } }}>
        <legend>{t('juno.chooseColor')}</legend>
        {JUNO_COLORS.map((color, i) => <button key={color} type="button" autoFocus={i === 0} disabled={disabled} className="juno-color-choice"
          style={{ backgroundColor: JUNO_PALETTE[color] }} onClick={() => play(chosen, color)}>{t(COLOR_KEYS[color])}</button>)}
        <button type="button" className="juno-text-button" onClick={cancelColor}>{t('common:actions.cancel')}</button>
      </fieldset>}
    </> : <p className="juno-spectator">{t('juno.spectating')}</p>}
    <div className="juno-hand-actions"><div className="juno-local-player">{seat('bottom')}</div>
      {isPlayer && <>
        {game.drawnCardId && !blind && <button type="button" className="juno-text-button juno-pass" aria-label={t('juno.pass')} title={t('juno.pass')} disabled={disabled || !myTurn} onClick={() => void command({ type: 'pass' })}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 5 7 7-7 7m7-14 7 7-7 7" /></svg></button>}
        <button type="button" className={`juno-announce${sayJuno ? ' juno-announce-ready' : ''}`} aria-label={t('juno.sayJuno')} title={t('juno.sayJuno')}
          aria-pressed={sayJuno} disabled={disabled || !myTurn || handCount !== 2 || game.supportsAnnounce && sayJuno}
          onClick={() => { if (game.supportsAnnounce) void command({ type: 'announce' }); else setAnnounceRevision(sayJuno ? null : revision); }}><img src={JUNO_ASSETS.logo} alt="" aria-hidden="true" /></button>
      </>}
    </div>
    {game.lastMove?.type === 'play' && <p className="sr-only" role="status">{t('juno.lastPlay', { name: movePlayer?.name ?? '', card: game.lastMove.card ? cardLabel(game.lastMove.card) : '' })}
      {!!game.lastMove.amount && <span> {t('juno.missedJuno')}</span>}</p>}
    {game.lastMove?.type === 'announce' && <p className="sr-only" role="status">{t('juno.announcedBy', { name: movePlayer?.name ?? '' })}</p>}
    {game.lastMove?.type === 'report' && <p className="sr-only" role="status" aria-label={t('juno.report')}>
      {t('juno.reportConfirmed', { reporter: playerName(movePlayer), target: playerName(moveTarget), amount: formatNumber(game.lastMove.amount ?? 0) })}</p>}
    {game.lastMove?.type === 'memory_miss' && <p className="sr-only" role="status">{t('juno.memory.miss', { name: playerName(movePlayer), amount: formatNumber(game.lastMove.amount ?? 0) })}</p>}
  </div>;
}
