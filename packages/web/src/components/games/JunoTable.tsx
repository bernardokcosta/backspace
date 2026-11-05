import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { JUNO_COLORS, canPlayJuno, type JunoCard as Card, type JunoColor } from '@backspace/shared/src/juno';
import { useJunoStore } from '../../stores/junoStore';
import { useSharedSecondBeat } from '../../hooks/useSharedSecondBeat';
import { useFormatters } from '../../i18n/formatters';
import { describeError } from '../../i18n/errors';
import { JunoCard, JUNO_PALETTE } from './JunoCard';
import './juno.css';

const COLOR_KEYS = { coral: 'juno.colors.coral', amber: 'juno.colors.amber', mint: 'juno.colors.mint', sky: 'juno.colors.sky' } as const;
const FACE_KEYS = { skip: 'juno.faces.skip', reverse: 'juno.faces.reverse', draw2: 'juno.faces.draw2', wild: 'juno.faces.wild', draw4: 'juno.faces.draw4' } as const;
const RESULT_KEYS = { emptyHand: 'juno.finished', playersLeft: 'juno.results.playersLeft', stalemate: 'juno.results.stalemate', expired: 'juno.results.expired' } as const;

export function JunoTable() {
  const { t } = useTranslation(['voice', 'common']);
  const { formatNumber, formatDuration } = useFormatters();
  const { snapshot, target, connected, loading, pending, error, observedAt } = useJunoStore();
  const game = snapshot?.game;
  const revision = snapshot?.revision ?? -1;
  const now = useSharedSecondBeat();
  const [colorChoice, setColorChoice] = useState<{ card: Card; revision: number } | null>(null);
  const [announceRevision, setAnnounceRevision] = useState<number | null>(null);
  const [leaveRevision, setLeaveRevision] = useState<number | null>(null);
  const command = useJunoStore(s => s.command);
  const disabled = !connected || pending || !snapshot;
  const selfId = target?.selfId;
  const isPlayer = !!game?.players.some(p => p.userId === selfId);
  const myTurn = game?.phase === 'playing' && game.currentPlayerId === selfId;
  const current = game?.players.find(p => p.userId === game.currentPlayerId);
  const winner = game?.players.find(p => p.userId === game.winnerId);
  const seconds = Math.ceil(Math.max(0, (game?.remainingMs ?? 0) - Math.max(0, now - observedAt)) / 1000);
  const sayJuno = announceRevision === revision;
  const chosen = colorChoice?.revision === revision && myTurn ? colorChoice.card : null;
  const canPlay = (card: Card) => !!myTurn && !!game?.topCard && !!game.color
    && (!game.drawnCardId || game.drawnCardId === card.id) && canPlayJuno(card, game.hand, game.topCard, game.color);
  const faceLabel = (card: Card) => /^\d$/.test(card.face) ? formatNumber(Number(card.face)) : t(FACE_KEYS[card.face as keyof typeof FACE_KEYS]);
  const cardLabel = (card: Card) => t('juno.card', { color: card.color ? t(COLOR_KEYS[card.color]) : '', face: faceLabel(card) });
  const play = (card: Card, color?: JunoColor) => {
    void command({ type: 'play', cardId: card.id, ...(color ? { color } : {}), announce: sayJuno });
    setColorChoice(null);
  };

  return <section className="juno-table" aria-label={t('juno.name')}>
    <header className="juno-header">
      <div className="juno-heading"><strong>{t('juno.name')}</strong><span>{t('juno.tagline')}</span></div>
      <div className="juno-header-actions">
        {isPlayer && <button type="button" className="juno-text-button" onClick={() => setLeaveRevision(revision)}>{t('juno.leave')}</button>}
        <button type="button" className="juno-text-button glass-pill" onClick={() => useJunoStore.getState().setOpen(false)}>{t('juno.mosaic')}</button>
      </div>
    </header>
    {!connected && <p className="juno-notice" role="status">{t('juno.reconnecting')}</p>}
    {!!error && <div className="juno-error" role="alert"><span>{describeError(error)}</span><button type="button" className="juno-text-button" onClick={() => void useJunoStore.getState().load()}>{t('common:actions.retry')}</button></div>}
    {leaveRevision === revision && isPlayer && <div className="juno-notice glass" role="group" aria-label={t('juno.leaveConfirm')}>
      <span>{t('juno.leaveConfirm')}</span>
      <button type="button" className="juno-text-button" onClick={() => { setLeaveRevision(null); void command({ type: 'leave' }); }} disabled={disabled}>{t('juno.leave')}</button>
      <button type="button" className="juno-text-button" onClick={() => setLeaveRevision(null)}>{t('common:actions.cancel')}</button>
    </div>}
    {!game ? <div className="juno-lobby juno-empty">
      <div className="juno-hero-cards"><JunoCard card={{ id: 'hero1', color: 'mint', face: 'reverse' }} /><JunoCard card={{ id: 'hero2', color: 'coral', face: '7' }} /><JunoCard back /></div>
      <h2>{t('juno.invitation')}</h2><p>{t('juno.description')}</p>
      {loading && !snapshot ? <p role="status">{t('common:states.loading')}</p>
        : <button type="button" className="juno-primary" disabled={disabled} onClick={() => void command({ type: 'create' })}>{t('juno.create')}</button>}
    </div> : <>
      <div className="juno-players" aria-label={t('juno.players')}>
        {game.players.map(player => <div key={player.userId} className={`juno-player ${game.currentPlayerId === player.userId ? 'juno-player-active' : ''}`}>
          <span className="juno-player-avatar" aria-hidden="true">{player.name.slice(0, 1)}</span>
          <div><strong title={player.name}>{player.name}{player.userId === selfId && <span className="juno-you">{t('juno.you')}</span>}</strong>
            <span>{game.phase === 'lobby' ? player.userId === game.hostId ? t('juno.host') : t('juno.ready') : t('juno.cardCount', { count: player.cardCount })}</span></div>
          {player.announced && <span className="juno-called">{t('juno.name')}</span>}
        </div>)}
        {game.phase === 'lobby' && Array.from({ length: 4 - game.players.length }, (_, index) => <div key={index} className="juno-player juno-seat-empty"><span className="juno-seat-plus" aria-hidden="true">+</span><span>{t('juno.emptySeat')}</span></div>)}
      </div>
      {game.phase === 'lobby' ? <div className="juno-lobby">
        <div className="juno-hero-cards"><JunoCard card={{ id: 'lobby1', color: 'sky', face: 'skip' }} /><JunoCard card={{ id: 'lobby2', color: 'amber', face: '4' }} /><JunoCard back /></div>
        <h2>{t('juno.lobbyTitle')}</h2><p>{t('juno.lobbyHint')}</p>
        <p className="juno-seat-count">{t('juno.seats', { occupied: game.players.length, max: 4 })}</p>
        {selfId === game.hostId ? <button type="button" className="juno-primary" disabled={disabled || game.players.length < 2} onClick={() => void command({ type: 'start' })}>{t('juno.start')}</button>
          : !isPlayer ? <button type="button" className="juno-primary" disabled={disabled || game.players.length >= 4} onClick={() => void command({ type: 'join' })}>{game.players.length >= 4 ? t('juno.full') : t('juno.join')}</button>
            : <p role="status">{t('juno.waitingHost')}</p>}
      </div> : <>
        <div className="juno-center">
          <div className="juno-piles">
            <div className="juno-pile">{isPlayer && game.phase === 'playing'
              ? <button type="button" className="juno-draw-art" aria-label={t('juno.drawPile')} disabled={disabled || !myTurn || !!game.drawnCardId}
                onClick={() => void command({ type: 'draw' })}><JunoCard back /></button>
              : <div className="juno-draw-art"><JunoCard back /></div>}<span>{t('juno.drawPile')}</span></div>
            <div className="juno-pile"><div className="juno-discard" aria-label={game.topCard ? cardLabel(game.topCard) : undefined}><JunoCard card={game.topCard ?? undefined} /></div><span>{t('juno.discardPile')}</span></div>
          </div>
          <div className="juno-table-info">
            {game.color && <span className="juno-active-color"><i style={{ backgroundColor: JUNO_PALETTE[game.color] }} />{t('juno.activeColor', { color: t(COLOR_KEYS[game.color]) })}</span>}
            <span className="juno-direction"><b aria-hidden="true">{game.direction === 1 ? '↻' : '↺'}</b>{game.direction === 1 ? t('juno.clockwise') : t('juno.counterclockwise')}</span>
          </div>
        </div>
        {game.phase === 'finished' ? <div className="juno-result" role="status">
          <h2>{winner ? t('juno.winner', { name: winner.name }) : t('juno.finished')}</h2>
          <p>{game.result && t(RESULT_KEYS[game.result])}</p>
          {selfId === game.hostId && <button type="button" className="juno-primary" disabled={disabled} onClick={() => void command({ type: 'rematch' })}>{t('juno.rematch')}</button>}
        </div> : <div className="juno-turn" role="status" aria-live="polite">
          <strong>{myTurn ? t('juno.yourTurn') : t('juno.theirTurn', { name: current?.name ?? '' })}</strong>
          <span className={seconds <= 10 ? 'text-accent-amber' : ''} aria-hidden="true">{formatDuration(seconds)}</span>
        </div>}
        {!isPlayer ? <p className="juno-spectator">{t('juno.spectating')}</p> : game.phase === 'playing' && <>
          <div className="juno-hand-header"><span>{t('juno.yourHand')}</span><span>{game.drawnCardId ? t('juno.drawnHint') : myTurn ? t('juno.playHint') : t('juno.waitHint')}</span></div>
          <div className="juno-hand" role="group" aria-label={t('juno.yourHand')}>
            {game.hand.map(card => <button key={card.id} type="button" className={`juno-hand-card ${canPlay(card) ? 'juno-card-legal' : ''}`}
              disabled={disabled || !canPlay(card)} aria-label={t('juno.playCard', { card: cardLabel(card) })}
              title={cardLabel(card)} onClick={() => card.color ? play(card) : setColorChoice({ card, revision })}>
              <JunoCard card={card} />
            </button>)}
          </div>
          {chosen && <fieldset className="juno-color-picker glass" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setColorChoice(null); } }}>
            <legend>{t('juno.chooseColor')}</legend>
            {JUNO_COLORS.map((color, index) => <button key={color} type="button" autoFocus={index === 0} disabled={disabled}
              className="juno-color-choice" style={{ backgroundColor: JUNO_PALETTE[color] }} onClick={() => play(chosen, color)}>{t(COLOR_KEYS[color])}</button>)}
            <button type="button" className="juno-text-button" onClick={() => setColorChoice(null)}>{t('common:actions.cancel')}</button>
          </fieldset>}
          <div className="juno-hand-actions">
            <button type="button" className="juno-primary" disabled={disabled || !myTurn} onClick={() => void command({ type: game.drawnCardId ? 'pass' : 'draw' })}>{game.drawnCardId ? t('juno.pass') : t('juno.draw')}</button>
            {game.hand.length === 2 && <label className="juno-announce"><input type="checkbox" disabled={disabled || !myTurn} checked={sayJuno} onChange={e => setAnnounceRevision(e.target.checked ? revision : null)} />{t('juno.sayJuno')}</label>}
          </div>
        </>}
        {game.lastMove?.type === 'play' && <p className="juno-last-move" role="status">{t('juno.lastPlay', { name: game.players.find(p => p.userId === game.lastMove!.userId)?.name ?? '', card: game.lastMove.card ? cardLabel(game.lastMove.card) : '' })}
          {!!game.lastMove.amount && <span> {t('juno.missedJuno')}</span>}</p>}
      </>}
    </>}
    <details className="juno-rules"><summary>{t('juno.rules')}</summary><p>{t('juno.rulesText')}</p></details>
  </section>;
}
