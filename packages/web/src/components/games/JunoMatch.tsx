import { useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { JUNO_COLORS, canPlayJuno, type JunoCard as Card, type JunoColor } from '@backspace/shared/src/juno';
import { useJunoStore } from '../../stores/junoStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useSharedSecondBeat } from '../../hooks/useSharedSecondBeat';
import { useFormatters } from '../../i18n/formatters';
import { JunoCard, JUNO_PALETTE } from './JunoCard';
import { JunoPlayerBadge } from './JunoPlayerBadge';
import { JUNO_ASSETS } from './junoAssets';
import { junoSeats } from './junoSeats';

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
  const sayJuno = announceRevision === revision;
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
  const seat = (position: keyof typeof seats) => {
    const person = seats[position];
    const side = position === 'left' || position === 'right';
    const visibleCards = Math.min(10, person?.cardCount ?? 0);
    return <div key={position} data-seat={position} className={`juno-seat juno-seat-${position}`}>
      {person ? <>
        <JunoPlayerBadge person={person} origin={target?.origin ?? ''} spaceId={spaceId} self={person.userId === selfId}
          active={person.userId === game.currentPlayerId} detail={t('juno.cardCount', { count: person.cardCount })} />
        {person.userId !== selfId && <div className={`juno-opponent-cards${side ? ' juno-side-hand' : ''}`} aria-hidden="true">
          {Array.from({ length: visibleCards }, (_, i) => side
            ? <span key={i} className="juno-side-card" style={{ '--juno-card-tilt': `${(i - (visibleCards - 1) / 2) * 3}deg` } as CSSProperties}><JunoCard back /></span>
            : <JunoCard back key={i} />)}
        </div>}
        {person.announced && <span className="juno-called">{t('juno.name')}</span>}
      </> : <span className="juno-empty-position">{t('juno.emptySeat')}</span>}
    </div>;
  };
  return <div className="juno-match">
    <div className="juno-arena">
      <img className="juno-orbit" src={JUNO_ASSETS.orbit} alt="" aria-hidden="true" />
      {seat('top')}{seat('left')}{seat('right')}
      <div className="juno-center"><div className="juno-piles">
        <div className="juno-pile"><div className="juno-discard" aria-label={game.topCard ? cardLabel(game.topCard) : undefined}><JunoCard card={game.topCard ?? undefined} /></div><span>{t('juno.discardPile')}</span></div>
        <div className="juno-pile">{isPlayer ? <button type="button" className="juno-draw-art" aria-label={t('juno.drawPile')}
          disabled={disabled || !myTurn || !!game.drawnCardId} onClick={() => void command({ type: 'draw' })}><JunoCard back /></button>
          : <div className="juno-draw-art"><JunoCard back /></div>}<span>{t('juno.drawPile')}</span></div>
      </div></div>
    </div>
    <div className="juno-turn" role="status" aria-live="polite"><strong>{myTurn ? t('juno.yourTurn') : t('juno.theirTurn', { name: current?.name ?? '' })}</strong>
      <span aria-hidden="true">{formatDuration(seconds)}</span></div>
    <div className="juno-table-info">
      {game.color && <span className="juno-active-color"><i style={{ backgroundColor: JUNO_PALETTE[game.color] }} />{t('juno.activeColor', { color: t(COLOR_KEYS[game.color]) })}</span>}
      <span className="juno-direction"><b aria-hidden="true">{game.direction === 1 ? '↻' : '↺'}</b>{game.direction === 1 ? t('juno.clockwise') : t('juno.counterclockwise')}</span>
    </div>
    {isPlayer ? <>
      <div className="juno-hand-header"><span>{t('juno.yourHand')}</span><span>{game.drawnCardId ? t('juno.drawnHint') : myTurn ? t('juno.playHint') : t('juno.waitHint')}</span></div>
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
    <div className="juno-local-player">{seat('bottom')}</div>
    {isPlayer && <div className="juno-hand-actions">
      <button type="button" className="juno-primary" disabled={disabled || !myTurn} onClick={() => void command({ type: game.drawnCardId ? 'pass' : 'draw' })}>{game.drawnCardId ? t('juno.pass') : t('juno.draw')}</button>
      {game.hand.length === 2 && <label className="juno-announce"><input type="checkbox" disabled={disabled || !myTurn} checked={sayJuno}
        onChange={event => setAnnounceRevision(event.target.checked ? revision : null)} />{t('juno.sayJuno')}</label>}
    </div>}
    {game.lastMove?.type === 'play' && <p className="juno-last-move" role="status">{t('juno.lastPlay', { name: game.players.find(p => p.userId === game.lastMove!.userId)?.name ?? '', card: game.lastMove.card ? cardLabel(game.lastMove.card) : '' })}
      {!!game.lastMove.amount && <span> {t('juno.missedJuno')}</span>}</p>}
  </div>;
}
