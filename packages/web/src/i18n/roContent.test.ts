import { describe, expect, it } from 'vitest';
import admin from '../locales/ro/admin.json';
import chat from '../locales/ro/chat.json';
import common from '../locales/ro/common.json';
import dm from '../locales/ro/dm.json';
import errors from '../locales/ro/errors.json';
import settings from '../locales/ro/settings.json';
import spaces from '../locales/ro/spaces.json';
import voice from '../locales/ro/voice.json';

describe('Romanian contextual content', () => {
  it('uses the Romanian word for nickname instead of an Italian false friend', () => {
    expect(errors.member_nickname_invalid).toContain('Poreclele pot avea');
    expect(errors.member_nickname_invalid).not.toContain('Soprannumele');
  });

  it('agrees the credential error with both alternatives', () => {
    expect(errors.invalid_credentials).toBe('Nume de utilizator sau parolă greșite.');
  });

  it('distinguishes a request timeout from an expired invitation', () => {
    expect(errors.clientRequestTimeout).toBe('Cererea a depășit timpul limită');
    expect(errors.clientRequestTimeout).not.toBe('Cererea a expirat');
  });

  it('names the microphone action rather than a mute state', () => {
    expect(settings.keybinds.action.toggleMute).toBe('Comută microfonul');
    expect(settings.keybinds.action.toggleMute).not.toContain('mutarea');
  });

  it('keeps turn announcements gender-neutral for arbitrary names', () => {
    expect(voice.juno.theirTurn).toBe('Urmează {{name}}');
    expect(voice.juno.theirTurn).not.toContain('lui');
  });

  it('calls the automated players bots, not computers', () => {
    expect(voice.juno.reportRules).toContain('Boții nu raportează niciodată automat.');
    expect(voice.juno.reportRules).not.toContain('Calculatoarele');
  });

  it('labels the create-invite permission as a singular action', () => {
    expect(spaces.permissions.names.createInvite).toBe('Creează invitație');
  });

  it('agrees the preventive cleanup adjective with its noun', () => {
    expect(admin.storage.stale.description).toContain('curățenia preventivă');
    expect(admin.storage.stale.description).not.toContain('curățenia preventiv.');
  });

  it('keeps the sticker collection hint natural', () => {
    expect(chat.stickers.collectionHint).toBe('Alege un sticker de trimis. Personalizează acest spațiu.');
  });

  it('distinguishes the Backspace key from the application name', () => {
    expect(voice.soundboard.shortcutHint).toContain('Tasta Backspace golește o scurtătură.');
  });

  it('describes joining without microphone access as listening', () => {
    expect(voice.micPrearm.denied).toContain('Te-ai alăturat ca ascultător.');
    expect(voice.micPrearm.denied).not.toContain('modul ascultare');
  });

  it('keeps Veyvox and Juno automatic labels distinct', () => {
    expect(common.language.automatic).toBe('Automat (sistem)');
    expect(voice.juno.settings.automatic).toBe('Automat (Veyvox)');
    expect(voice.juno.settings.automaticDubbing).toBe(voice.juno.settings.automatic);
  });

  it('names a group direct message without an English possessive', () => {
    expect(dm.names.groupFallback).toBe('DM de grup');
  });

  it('describes per-listener mute without claiming to cut the remote microphone', () => {
    expect(voice.participantMenu.muteUser).toBe('Silențiază utilizatorul');
    expect(spaces.mobile.muteUser).toBe('Silențiază utilizatorul');
    expect(voice.participantMenu.muteUser).not.toContain('microfonul');
  });

  it('uses a neutral reaction label when the viewer is part of a mixed list', () => {
    expect(chat.message.reactions.byMany).toBe('Reacții: {{names}}');
  });

  it('uses an invariant minute unit after every supplied AFK number', () => {
    expect(spaces.settings.afk.minutes).toBe('min');
  });

  it('keeps both verbs in the Juno memory restriction in the infinitive', () => {
    expect(voice.juno.guide.memory.limits).toContain('Nu poți trage sau trece');
    expect(voice.juno.guide.memory.limits).not.toContain('trage sau treci');
  });
});
