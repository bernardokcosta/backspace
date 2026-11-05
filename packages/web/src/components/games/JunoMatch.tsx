import { useRef, useState, type CSSProperties } from 'react';
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
const FACE_KEYS = { skip: 'juno.faces.skip', reverse: 'juno.faces.reverse', draw2: 'juno.faces.draw2', wild: 'juno.faces.wild', draw4: 'juno.faces.draw4' } as const;
export function JunoMatch() {
  const { t } = useTranslation(['voice', 'common']); const { formatNumber, formatDuration } = useFormatters();
  const { snapshot, target, connected, pending, command, observedAt } = useJunoStore();
  const spaceId = useSpaceStore(s => target ? s.spaceChannelIndex.get(target.channelId)?.spaceId ?? '' : '');
  const now = useSharedSecondBeat();
  const [colorChoice, setColorChoice] = useState<{ card: Card; revision: number; gameId: string } | null>(null);
  const [announceRevision, setAnnounceRevision] = useState<number | null>(null);
  const colorTrigger = useRef<HTMLButtonElement | null>(null);
  const game = snapshot?.game;
  if (!game || game.phase !== 'playing') return null;
  const revision = snapshot.revision; const selfId = target?.selfId;
  const disabled = !connected || pending; const myTurn = game.currentPlayerId === selfId;
  const isPlayer = game.players.some(p => p.userId === selfId);
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
    return <div key={position} data-seat={position} className={`juno-seat juno-seat-${position}`}>
      {person ? <>
        <JunoPlayerBadge person={person} origin={target?.origin ?? ''} spaceId={spaceId} self={person.userId === selfId}
          active={person.userId === game.currentPlayerId} next={person.userId === next?.userId} detail={t('juno.cardCount', { count: person.cardCount })} />
        {opportunity && <button type="button" className="juno-report glass" aria-label={t('juno.reportPlayer', { name: playerName(person) })}
          title={t('juno.reportPlayer', { name: playerName(person) })} disabled={disabled || reportSeconds <= 0}
          onClick={() => { if (opportunity.remainingMs > Math.max(0, Date.now() - observedAt)) void command({ type: 'report', targetUserId: person.userId, opportunityId: opportunity.id }); }}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 21V4m0 0c4-3 8 3 14 0v10c-6 3-10-3-14 0" /></svg>
          <span className="juno-report-label">{t('juno.report')}</span>
          <span className="juno-report-time" aria-label={t('juno.reportTime', { seconds: formatNumber(reportSeconds) })}>{formatNumber(reportSeconds)}</span>
        </button>}
        {person.userId !== selfId && !opportunity && <div className={`juno-opponent-cards${side ? ' juno-side-hand' : ''}`} aria-hidden="true">
          {Array.from({ length: visibleCards }, (_, i) => side
            ? <span key={i} className="juno-side-card" style={{ '--juno-card-tilt': `${(i - (visibleCards - 1) / 2) * 3}deg` } as CSSProperties}><JunoCard back /></span>
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
  return <div className={`juno-match${myTurn ? ' juno-my-turn' : ''}`}>
    <JunoEffects move={game.lastMove} position={movePosition} name={playerName(effectPlayer)} />
    <div className="juno-arena">
      <img className="juno-orbit" src={JUNO_ASSETS.orbit} alt="" aria-hidden="true" />
      {seat('top')}{seat('left')}{seat('right')}
      <div className="juno-center"><div className="juno-piles">
        <div className="juno-pile"><div className="juno-discard" aria-label={game.topCard ? cardLabel(game.topCard) : undefined}><JunoCard card={game.topCard ?? undefined} /></div><span>{t('juno.discardPile')}</span></div>
        <div className="juno-pile">{isPlayer ? <button type="button" className="juno-draw-art" aria-label={t('juno.drawPile')}
          disabled={disabled || !myTurn || !!game.drawnCardId} onClick={() => void command({ type: 'draw' })}><JunoCard back /></button>
          : <div className="juno-draw-art"><JunoCard back /></div>}<span>{t('juno.drawPile')}</span></div>
      </div><div className="juno-table-info">
        {game.color && <span className="juno-active-color" title={t('juno.activeColor', { color: t(COLOR_KEYS[game.color]) })} aria-label={t('juno.activeColor', { color: t(COLOR_KEYS[game.color]) })}><i style={{ backgroundColor: JUNO_PALETTE[game.color] }} /></span>}
        <span className="juno-direction" title={game.direction === 1 ? t('juno.clockwise') : t('juno.counterclockwise')}><b aria-hidden="true">{game.direction === 1 ? '↻' : '↺'}</b></span>
        <span className="juno-timer" aria-label={t('juno.turnTime')}>{formatDuration(seconds)}</span>
      </div></div>
    </div>
    <div className="sr-only" role="status" aria-live="polite">{myTurn ? t('juno.yourTurn') : t('juno.theirTurn', { name: current?.name ?? '' })}</div>
    {isPlayer ? <>
      <div className="juno-hand" role="group" aria-label={t('juno.yourHand')}>
        {game.hand.map(card => <button key={card.id} type="button" className={`juno-hand-card${canPlay(card) ? ' juno-card-legal' : ''}`}
          disabled={disabled || !canPlay(card)} aria-label={t('juno.playCard', { card: cardLabel(card) })} title={cardLabel(card)}
          onClick={event => { if (card.color) play(card); else { colorTrigger.current = event.currentTarget; setColorChoice({ card, revision, gameId: game.id }); } }}><JunoCard card={card} /></button>)}
      </div>
      {chosen && <fieldset className="juno-color-picker glass" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); cancelColor(); } }}>
        <legend>{t('juno.chooseColor')}</legend>
        {JUNO_COLORS.map((color, i) => <button key={color} type="button" autoFocus={i === 0} disabled={disabled} className="juno-color-choice"
          style={{ backgroundColor: JUNO_PALETTE[color] }} onClick={() => play(chosen, color)}>{t(COLOR_KEYS[color])}</button>)}
        <button type="button" className="juno-text-button" onClick={cancelColor}>{t('common:actions.cancel')}</button>
      </fieldset>}
    </> : <p className="juno-spectator">{t('juno.spectating')}</p>}
    <div className="juno-hand-actions"><div className="juno-local-player">{seat('bottom')}</div>
      {isPlayer && <>
        {game.drawnCardId && <button type="button" className="juno-text-button juno-pass" aria-label={t('juno.pass')} title={t('juno.pass')} disabled={disabled || !myTurn} onClick={() => void command({ type: 'pass' })}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 5 7 7-7 7m7-14 7 7-7 7" /></svg></button>}
        <button type="button" className={`juno-announce${sayJuno ? ' juno-announce-ready' : ''}`} aria-label={t('juno.sayJuno')} title={t('juno.sayJuno')}
          aria-pressed={sayJuno} disabled={disabled || !myTurn || game.hand.length !== 2 || game.supportsAnnounce && sayJuno}
          onClick={() => { if (game.supportsAnnounce) void command({ type: 'announce' }); else setAnnounceRevision(sayJuno ? null : revision); }}><img src={JUNO_ASSETS.logo} alt="" aria-hidden="true" /></button>
      </>}
    </div>
    {game.lastMove?.type === 'play' && <p className="sr-only" role="status">{t('juno.lastPlay', { name: movePlayer?.name ?? '', card: game.lastMove.card ? cardLabel(game.lastMove.card) : '' })}
      {!!game.lastMove.amount && <span> {t('juno.missedJuno')}</span>}</p>}
    {game.lastMove?.type === 'announce' && <p className="sr-only" role="status">{t('juno.announcedBy', { name: movePlayer?.name ?? '' })}</p>}
    {game.lastMove?.type === 'report' && <p className="sr-only" role="status" aria-label={t('juno.report')}>
      {t('juno.reportConfirmed', { reporter: playerName(movePlayer), target: playerName(moveTarget), amount: formatNumber(game.lastMove.amount ?? 0) })}</p>}
  </div>;
}
