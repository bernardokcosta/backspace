import { describe, expect, it } from 'vitest';
import chat from '../locales/sv/chat.json';
import common from '../locales/sv/common.json';
import dm from '../locales/sv/dm.json';
import spaces from '../locales/sv/spaces.json';
import voice from '../locales/sv/voice.json';
import settings from '../locales/sv/settings.json';
import federation from '../locales/sv/federation.json';
import errors from '../locales/sv/errors.json';

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
}

describe('Swedish contextual content', () => {
  it('keeps home-instance compounds and sticker-pack words intact', () => {
    const catalogs = import.meta.glob('../locales/sv/*.json', { eager: true, import: 'default' });
    for (const value of strings(catalogs)) {
      expect(value).not.toMatch(/hemmanstans|dekalpaketetet|admingsgranskning|spel ikonen/iu);
    }
  });

  it('describes an authentication credential rather than an unrelated reference', () => {
    for (const value of [federation.validation.connectHomeFirst, federation.connections.add.passwordHint,
      federation.connections.add.fallbackNotice.credentialRefused]) {
      expect(value).toContain('autentiseringsuppgift');
      expect(value).not.toContain('referens');
    }
    expect(federation.connections.add.probing).toBe('Sonderar…');
  });

  it('translates keybind actions without an adjective standing in for deafen', () => {
    expect(settings.keybinds.action.toggleMute).toBe('Växla mutning');
    expect(settings.keybinds.action.toggleDeafen).toBe('Växla dövning');
    expect(settings.keybinds.action.pushToTalk).toBe('Tryck för att prata');
  });

  it('suppresses notifications without promising to hide the mention text', () => {
    expect(spaces.notifications.suppressEveryone).toBe('Tysta @everyone och @here');
    expect(spaces.notifications.suppressRoles).toBe('Tysta rollomnämnanden');
    expect(spaces.notifications.mute.indefinite).toBe('Tills jag slår på aviseringar igen');
    expect(spaces.notifications.mutedIndefinitely).toBe('Mutad tills du slår på aviseringar igen');
  });

  it('keeps arbitrary player names unchanged in the turn label', () => {
    expect(voice.juno.theirTurn).toBe('Tur för {{name}}');
    expect(voice.juno.reportRules).toContain('inget straff');
    expect(voice.juno.scoreRules).toContain('Vid oavgjort delas plats och XP.');
    expect(errors.game_icon_not_found).toBe('Spelikonen finns inte längre.');
  });

  it('describes per-listener mute without claiming a server mute', () => {
    expect(voice.participantMenu.muteUser).toBe('Muta för mig');
    expect(spaces.mobile.muteUser).toBe('Muta användare');
  });

  it('scopes Space moderation to the Space', () => {
    expect(voice.moderation.spaceMute).toBe('Muta i rummet');
    expect(voice.moderation.spaceDeafen).toBe('Döva i rummet');
  });

  it('uses a neutral reaction label when the viewer is part of a mixed list', () => {
    expect(chat.message.reactions.byMany).toBe('Reaktioner: {{names}}');
  });

  it('keeps Veyvox and Juno automatic labels distinct', () => {
    expect(common.language.automatic).toBe('Automatiskt (system)');
    expect(voice.juno.settings.automatic).toBe('Automatiskt (Veyvox)');
    expect(voice.juno.settings.automaticDubbing).toBe(voice.juno.settings.automatic);
  });

  it('names a group direct message without addressing it as a person', () => {
    expect(dm.names.groupFallback).toBe('Grupp-DM');
  });

  it('keeps the rare Alzheimer card rule complete', () => {
    expect(voice.juno.memory.rules).toContain('Alzheimer');
    expect(voice.juno.faces.memory).toBe('Alzheimer');
  });

  it('uses a translated minute unit for AFK', () => {
    expect(spaces.settings.afk.minutes).toBe('min');
  });
});
