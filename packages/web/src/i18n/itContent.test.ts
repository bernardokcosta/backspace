import { describe, expect, it } from 'vitest';
import chat from '../locales/it/chat.json';
import common from '../locales/it/common.json';
import desktop from '../locales/it/desktop.json';
import errors from '../locales/it/errors.json';
import voice from '../locales/it/voice.json';

describe('Italian contextual content', () => {
  it('uses count-neutral wording when few sticker slots remain', () => {
    expect(chat.stickers.capacityLimit_one).toBe('La tua raccolta ha spazio per {{count}} sticker in più.');
    expect(chat.stickers.capacityLimit_one).not.toContain('altri');
    expect(chat.stickers.capacityLimit_other).toContain('{{count}}');
  });

  it('keeps the group settings action grammatical', () => {
    expect(chat.list.welcome.group.openSettings).toBe('Apri le impostazioni del gruppo');
  });

  it('connects the draw instruction instead of running two clauses together', () => {
    expect(voice.juno.guide.turn.draw).toContain('una carta, ma non continuare a pescare');
  });

  it('describes expiry with an impersonal no-moves-left clause', () => {
    expect(voice.juno.guide.table.expiry).toContain('non ci sono più mosse valide');
    expect(voice.juno.guide.table.expiry).not.toContain('non restano mosse valide');
  });

  it('names the skip card instead of repeating the verb', () => {
    expect(voice.juno.rulesText).toContain('La carta Salta fa saltare il giocatore successivo');
    expect(voice.juno.rulesText).toContain('Inverti cambia il senso di gioco');
    expect(voice.juno.rulesText).not.toContain('Salta salta');
  });

  it('uses a natural draw-card response clause', () => {
    expect(voice.juno.guide.effects.draw2).toContain('un’altra carta che fa pescare');
    expect(voice.juno.guide.effects.draw2).not.toContain('carta pesca');
  });

  it('describes non-local sticker refusal using the configured instance terminology', () => {
    expect(errors.sticker_not_local).toContain('un’altra istanza');
    expect(errors.sticker_not_local).not.toContain('server');
  });

  it('keeps the desktop update breadcrumb in the same order as the settings UI', () => {
    expect(desktop.update.laterHint).toContain('Impostazioni → Desktop');
  });

  it('keeps Veyvox and Juno automatic labels distinct', () => {
    expect(common.language.automatic).toBe('Automatico (sistema)');
    expect(voice.juno.settings.automatic).toBe('Automatico (Veyvox)');
    expect(voice.juno.settings.automaticDubbing).toBe(voice.juno.settings.automatic);
  });
});
