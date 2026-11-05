import { randomInt, randomUUID } from 'node:crypto';
import { JUNO_COLORS, JUNO_TURN_MS, canPlayJuno, type JunoAction, type JunoCard,
  type JunoColor, type JunoCommand, type JunoMove, type JunoPerson, type JunoSnapshot, type JunoView, type JunoScoreboard } from '@backspace/shared/src/juno.js';
import { buildJunoStandings } from './junoStandings.js';
import type { JunoSettlement } from './junoProgression.js';
import { chooseJunoBotAction } from './junoBot.js';

export class JunoError extends Error {}
function refuse(code: string): never { throw new JunoError(code); }
function shuffle<T>(cards: T[]): void {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); [cards[i], cards[j]] = [cards[j]!, cards[i]!];
  }
}
export function createJunoDeck(): JunoCard[] {
  const cards: JunoCard[] = [];
  const add = (color: JunoColor | null, face: JunoCard['face']) => cards.push({ id: randomUUID(), color, face });
  for (const color of JUNO_COLORS) {
    add(color, '0');
    for (const face of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2'] as const) {
      add(color, face); add(color, face);
    }
  }
  for (let i = 0; i < 4; i++) { add(null, 'wild'); add(null, 'draw4'); }
  return cards;
}
interface Player extends JunoPerson { hand: JunoCard[]; announced: boolean }
export interface JunoRound {
  players: Player[];
  drawPile: JunoCard[];
  discard: JunoCard[];
  color: JunoColor;
  direction: 1 | -1;
  turn: number;
  drawnCardId: string | null;
  deadline: number;
  winnerId: string | null;
  result: JunoView['result'];
  lastMove: JunoMove | null;
  blockedTurns: number;
}
export function startRound(people: JunoPerson[], now: number): JunoRound {
  const deck = createJunoDeck(); shuffle(deck);
  const players = people.map(person => ({ ...person, hand: deck.splice(0, 7), announced: false }));
  const first = deck.findIndex(card => /^\d$/.test(card.face));
  const top = deck.splice(first, 1)[0]!;
  return { players, drawPile: deck, discard: [top], color: top.color!, direction: 1, turn: 0,
    drawnCardId: null, deadline: now + JUNO_TURN_MS, winnerId: null, result: null,
    lastMove: { type: 'start', userId: players[0]!.userId }, blockedTurns: 0 };
}
function nextIndex(round: JunoRound, steps = 1): number {
  return ((round.turn + round.direction * steps) % round.players.length + round.players.length) % round.players.length;
}
function advance(round: JunoRound, now: number, steps = 1): void {
  round.turn = nextIndex(round, steps); round.drawnCardId = null; round.deadline = now + JUNO_TURN_MS;
}
function drawCards(round: JunoRound, player: Player, amount: number): JunoCard[] {
  const drawn: JunoCard[] = [];
  for (let i = 0; i < amount; i++) {
    if (round.drawPile.length === 0 && round.discard.length > 1) {
      round.drawPile = round.discard.splice(0, round.discard.length - 1); shuffle(round.drawPile);
    }
    const card = round.drawPile.pop(); if (!card) break;
    player.hand.push(card); drawn.push(card);
  }
  if (drawn.length) { player.announced = false; round.blockedTurns = 0; }
  return drawn;
}
export function actInRound(round: JunoRound, userId: string, action: JunoAction, now: number): void {
  if (round.result) refuse('juno_invalid_move');
  const player = round.players[round.turn]!;
  if (player.userId !== userId) refuse('juno_not_your_turn');
  if (action.type === 'announce') {
    if (player.hand.length !== 2 || player.announced) refuse('juno_invalid_move');
    player.announced = true; round.lastMove = { type: 'announce', userId, announced: true }; return;
  }
  const top = round.discard[round.discard.length - 1]!;
  if (action.type === 'draw') {
    if (round.drawnCardId) refuse('juno_invalid_move');
    const drawn = drawCards(round, player, 1)[0];
    round.lastMove = { type: 'draw', userId, amount: drawn ? 1 : 0 };
    if (!drawn) {
      round.blockedTurns = player.hand.some(card => canPlayJuno(card, player.hand, top, round.color)) ? 0 : round.blockedTurns + 1;
      if (round.blockedTurns >= round.players.length) round.result = 'stalemate';
    }
    if (drawn && canPlayJuno(drawn, player.hand, top, round.color)) round.drawnCardId = drawn.id;
    else advance(round, now);
    return;
  }
  if (action.type === 'pass') {
    if (!round.drawnCardId) refuse('juno_invalid_move');
    round.lastMove = { type: 'pass', userId }; advance(round, now); return;
  }
  if (action.type !== 'play') refuse('juno_invalid_move');
  const index = player.hand.findIndex(card => card.id === action.cardId);
  const card = player.hand[index];
  if (!card || (round.drawnCardId && card.id !== round.drawnCardId)
      || !canPlayJuno(card, player.hand, top, round.color)
      || (card.color === null && (!action.color || !JUNO_COLORS.includes(action.color)))) refuse('juno_invalid_move');
  player.hand.splice(index, 1); round.discard.push(card);
  round.color = card.color ?? action.color!; round.blockedTurns = 0;
  player.announced = player.hand.length === 1 && (action.announce === true || player.announced);
  let penalty = 0;
  if (player.hand.length === 1 && !player.announced) penalty = drawCards(round, player, 2).length;
  let steps = 1;
  if (card.face === 'reverse') { round.direction = round.direction === 1 ? -1 : 1; if (round.players.length === 2) steps = 2; }
  if (card.face === 'skip') steps = 2;
  if (card.face === 'draw2' || card.face === 'draw4') {
    drawCards(round, round.players[nextIndex(round)]!, card.face === 'draw2' ? 2 : 4); steps = 2;
  }
  round.lastMove = { type: 'play', userId, card: { ...card }, amount: penalty, announced: player.announced };
  if (player.hand.length === 0) { round.winnerId = userId; round.result = 'emptyHand'; }
  advance(round, now, steps);
}

interface Table {
  id: string; hostId: string; people: JunoPerson[]; round: JunoRound | null;
  revision: number; createdAt: number; updatedAt: number;
  spaceId: string | null; starters: JunoPerson[];
  settlement?: JunoSettlement; scoreboard?: JunoScoreboard; retryAt: number;
  botTurn?: { userId: string; drawnCardId: string | null; due: number };
}
interface RoomOptions {
  present: (channelId: string, userId: string) => boolean;
  changed: (channelId: string) => void;
  now?: () => number;
  spaceIdForChannel?: (channelId: string) => string | null;
  settle?: (input: JunoSettlement) => JunoScoreboard;
}
/** Ephemeral authority. All state transitions complete synchronously before notifying readers. */
export class JunoRooms {
  private tables = new Map<string, Table>();
  private revision = 0;
  private now: () => number;
  constructor(private options: RoomOptions) { this.now = options.now ?? Date.now; }
  private changed(channelId: string, table?: Table): void {
    const revision = ++this.revision;
    if (table) {
      table.revision = revision; table.updatedAt = this.now();
      if (table.round?.lastMove && !table.round.lastMove.id) table.round.lastMove.id = randomUUID();
    }
    this.options.changed(channelId);
  }
  private complete(channelId: string, table: Table): void {
    const round = table.round;
    if (round?.result && table.starters.some(p => p.computer)) {
      if (!table.scoreboard) table.scoreboard = { roundId: table.id, status: 'unranked',
        standings: buildJunoStandings(table.starters, round.players.map(p => ({ userId: p.userId, cardCount: p.hand.length })), round.winnerId, round.result)
          .map(p => ({ ...p, xp: 0 })) };
      return;
    }
    if (!round?.result || !this.options.settle || !table.spaceId) return;
    if (!table.settlement) {
      table.settlement = { roundId: table.id, spaceId: table.spaceId, channelId, finishedAt: this.now(),
        scoringVersion: 1, result: round.result, standings: buildJunoStandings(table.starters,
          round.players.map(p => ({ userId: p.userId, cardCount: p.hand.length })), round.winnerId, round.result) };
      table.scoreboard = { roundId: table.id, status: round.result === 'emptyHand' ? 'pending' : 'unranked',
        standings: table.settlement.standings.map(p => ({ ...p })) };
    }
    if (table.scoreboard?.status !== 'pending' || this.now() < table.retryAt) return;
    table.retryAt = this.now() + 1000;
    try {
      // The integration cannot mutate the frozen proposal kept for a retry.
      table.scoreboard = this.options.settle({ ...table.settlement, standings: table.settlement.standings.map(p => ({ ...p })),
        ...(table.settlement.recipientIds ? { recipientIds: new Map(table.settlement.recipientIds) } : {}) });
      if (table.scoreboard.status !== 'pending') this.changed(channelId, table);
    } catch { /* The integration reports failures; keep the same pending result for the next pass. */ }
  }
  private remove(channelId: string, table: Table, userId: string): void {
    table.people = table.people.filter(person => person.userId !== userId);
    if (!table.people.some(person => !person.computer)) {
      if (table.scoreboard?.status === 'pending') { this.changed(channelId, table); return; }
      this.tables.delete(channelId); this.changed(channelId); return;
    }
    if (table.hostId === userId) table.hostId = table.people.find(person => !person.computer)!.userId;
    const round = table.round;
    if (round && !round.result) {
      const index = round.players.findIndex(p => p.userId === userId);
      if (index >= 0) {
        const currentId = round.players[round.turn]!.userId;
        const nextId = round.players[nextIndex(round)]!.userId;
        const [removed] = round.players.splice(index, 1);
        round.drawPile.push(...removed!.hand); shuffle(round.drawPile);
        round.turn = round.players.findIndex(p => p.userId === (currentId === userId ? nextId : currentId));
        if (round.turn < 0) round.turn = 0;
        if (currentId === userId) { round.drawnCardId = null; round.deadline = this.now() + JUNO_TURN_MS; }
        round.blockedTurns = 0;
        round.lastMove = { type: 'leave', userId };
        if (!round.result && round.players.length < 2) { round.result = 'playersLeft'; round.winnerId = null; }
      }
    }
    this.complete(channelId, table);
    this.changed(channelId, table);
  }
  private settle(channelId: string): void {
    const table = this.tables.get(channelId); if (!table) return;
    const now = this.now();
    this.complete(channelId, table);
    for (const person of [...table.people]) {
      if (!person.computer && !this.options.present(channelId, person.userId)) this.remove(channelId, table, person.userId);
    }
    if (!this.tables.has(channelId)) return;
    if (!table.people.length && table.scoreboard?.status !== 'pending') {
      this.tables.delete(channelId); this.changed(channelId); return;
    }
    const round = table.round;
    if (!round || round.result) {
      if (table.scoreboard?.status !== 'pending' && now - table.updatedAt >= 15 * 60_000) { this.tables.delete(channelId); this.changed(channelId); }
      return;
    }
    if (now - table.createdAt >= 2 * 60 * 60_000) {
      round.result = 'expired'; this.complete(channelId, table); this.changed(channelId, table); return;
    }
    if (now >= round.deadline) {
      const player = round.players[round.turn]!;
      const drawn = round.drawnCardId ? [] : drawCards(round, player, 1);
      if (!round.drawnCardId && !drawn.length) {
        const top = round.discard[round.discard.length - 1]!;
        round.blockedTurns = player.hand.some(card => canPlayJuno(card, player.hand, top, round.color)) ? 0 : round.blockedTurns + 1;
        if (round.blockedTurns >= round.players.length) round.result = 'stalemate';
      }
      round.lastMove = { type: 'timeout', userId: player.userId, amount: drawn.length };
      advance(round, now); this.complete(channelId, table); this.changed(channelId, table);
    }
    if (round.result) return;
    const player = round.players[round.turn]!;
    if (!player.computer) { table.botTurn = undefined; return; }
    if (!table.botTurn || table.botTurn.userId !== player.userId || table.botTurn.drawnCardId !== round.drawnCardId) {
      table.botTurn = { userId: player.userId, drawnCardId: round.drawnCardId, due: now + 900 }; return;
    }
    if (now < table.botTurn.due) return;
    table.botTurn = undefined;
    actInRound(round, player.userId, chooseJunoBotAction(player.hand, round.discard.at(-1)!, round.color, round.drawnCardId), now);
    this.complete(channelId, table); this.changed(channelId, table);
  }
  tick(): void { for (const channelId of this.tables.keys()) this.settle(channelId); }
  /** Only the committed, proof-authorized merge may redirect a pending award. */
  remapPendingRecipient(sourceId: string, targetId: string): void {
    if (sourceId === targetId) return;
    for (const table of this.tables.values()) {
      if (!table.settlement || table.scoreboard?.status !== 'pending') continue;
      const recipientIds = new Map(table.settlement.recipientIds);
      for (const row of table.settlement.standings) {
        if ((recipientIds.get(row.userId) ?? row.userId) === sourceId) recipientIds.set(row.userId, targetId);
      }
      table.settlement.recipientIds = recipientIds;
    }
  }
  dispose(): void { this.tables.clear(); }
  read(channelId: string, userId: string): JunoSnapshot {
    this.settle(channelId);
    const table = this.tables.get(channelId);
    if (!table) return { revision: this.revision, game: null };
    const round = table.round;
    const self = table.people.some(person => person.userId === userId && !person.computer) ? round?.players.find(person => person.userId === userId) : undefined;
    return { revision: table.revision, game: {
      id: table.id, phase: !round ? 'lobby' : round.result ? 'finished' : 'playing', hostId: table.hostId,
      players: table.people.map(person => {
        const player = round?.players.find(p => p.userId === person.userId);
        return { ...person, cardCount: player?.hand.length ?? 0, announced: player?.announced ?? false };
      }), hand: self?.hand.map(card => ({ ...card })) ?? [],
      topCard: round ? { ...round.discard[round.discard.length - 1]! } : null,
      color: round?.color ?? null, direction: round?.direction ?? 1,
      currentPlayerId: round && !round.result ? round.players[round.turn]!.userId : null,
      drawnCardId: self && round?.players[round.turn]?.userId === userId ? round.drawnCardId : null,
      remainingMs: round && !round.result ? Math.max(0, round.deadline - this.now()) : 0,
      winnerId: round?.winnerId ? table.settlement?.recipientIds?.get(round.winnerId) ?? round.winnerId : null, result: round?.result ?? null,
      lastMove: round?.lastMove ? { ...round.lastMove, ...(round.lastMove.card ? { card: { ...round.lastMove.card } } : {}) } : null,
      supportsBots: true, supportsAnnounce: true, practice: (round ? table.starters : table.people).some(p => !!p.computer),
      ...(table.scoreboard ? { scoreboard: { ...table.scoreboard, standings: table.scoreboard.standings.map(p => ({ ...p })) } } : {}),
    } };
  }
  command(channelId: string, person: JunoPerson, command: JunoCommand): JunoSnapshot {
    this.settle(channelId);
    let table = this.tables.get(channelId);
    if (person.computer || table?.people.some(p => p.userId === person.userId && p.computer)) refuse('juno_player_required');
    if (command.type === 'create') {
      if (table) refuse('juno_exists');
      if (this.tables.size >= 1_000) refuse('juno_capacity');
      table = { id: randomUUID(), hostId: person.userId, people: [{ ...person }], round: null,
        revision: 0, createdAt: this.now(), updatedAt: this.now(),
        spaceId: this.options.spaceIdForChannel?.(channelId) ?? null, starters: [], retryAt: 0 };
      this.tables.set(channelId, table); this.changed(channelId, table); return this.read(channelId, person.userId);
    }
    if (!table || command.gameId !== table.id || command.revision !== table.revision) refuse('juno_stale');
    const seated = table.people.some(p => p.userId === person.userId);
    if (command.type === 'join') {
      if (table.round) refuse('juno_in_progress');
      if (!seated) {
        if (table.people.length >= 4) refuse('juno_full');
        table.people.push({ ...person });
      }
    } else if (command.type === 'addBot' || command.type === 'removeBot') {
      if (table.hostId !== person.userId) refuse('juno_host_required');
      if (table.round) refuse('juno_in_progress');
      if (command.type === 'addBot') {
        if (table.people.length >= 4) refuse('juno_full');
        const computer = ([1, 2, 3] as const).find(n => !table!.people.some(p => p.computer === n))!;
        table.people.push({ userId: `juno-bot:${randomUUID()}`, name: `Juno Bot ${computer}`, computer });
      } else if (command.type === 'removeBot') {
        const botId = command.botId;
        if (!table.people.some(p => p.userId === botId && p.computer)) refuse('juno_invalid_move');
        table.people = table.people.filter(p => p.userId !== botId);
      }
    } else if (command.type === 'leave') {
      if (!seated) refuse('juno_player_required');
      this.remove(channelId, table, person.userId); return this.read(channelId, person.userId);
    } else {
      if (!seated) refuse('juno_player_required');
      if (command.type === 'start' || command.type === 'rematch') {
        if (table.hostId !== person.userId) refuse('juno_host_required');
        if (command.type === 'rematch') {
          if (!table.round?.result || table.scoreboard?.status === 'pending') refuse('juno_invalid_move');
          table.id = randomUUID(); table.round = null; table.people = [{ ...person }]; table.createdAt = this.now();
          table.starters = []; table.settlement = undefined; table.scoreboard = undefined; table.retryAt = 0; table.botTurn = undefined;
        } else {
          if (table.round || table.people.length < 2) refuse('juno_need_players');
          table.round = startRound(table.people, this.now()); table.createdAt = this.now();
          table.starters = table.people.map(p => ({ userId: p.userId, name: p.name, ...(p.computer ? { computer: p.computer } : {}) }));
        }
      } else {
        if (!table.round) refuse('juno_invalid_move');
        actInRound(table.round, person.userId, command, this.now());
      }
    }
    this.complete(channelId, table);
    this.changed(channelId, table); return this.read(channelId, person.userId);
  }
}
