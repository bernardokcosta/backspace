import { describe, expect, it } from 'vitest';
import chat from '../locales/fi/chat.json';
import common from '../locales/fi/common.json';
import dm from '../locales/fi/dm.json';
import spaces from '../locales/fi/spaces.json';
import voice from '../locales/fi/voice.json';
import admin from '../locales/fi/admin.json';
import desktop from '../locales/fi/desktop.json';

describe('Finnish contextual content', () => {
  it('keeps permission overrides and sort labels free of corrupted words', () => {
    expect(spaces.permissions.noMemberOverrides).toBe('Ei jäsenohituksia.');
    expect(common.actions.sortBy).toBe('Järjestysperuste');
    expect(admin.storage.uploadLimit.maxStickerSize).toBe('Maksimitarrankoko');
    expect(desktop.mediaSetup.neteaseSmtc.body).toContain('tarvitsee tätä');
  });

  it('does not append a guessed Finnish case ending to arbitrary player names', () => {
    expect(voice.juno.theirTurn).toBe('Vuoro: {{name}}');
    expect(voice.juno.chooseGame).toBe('Valitse peli pelattavaksi puhelussa olevien kanssa.');
  });

  it('describes per-listener mute without claiming a server mute', () => {
    expect(voice.participantMenu.muteUser).toBe('Mykistä puolestani');
    expect(spaces.mobile.muteUser).toBe('Mykistä käyttäjä');
  });

  it('scopes Space moderation to the Space', () => {
    expect(voice.moderation.spaceMute).toBe('Mykistä tilassa');
    expect(voice.moderation.spaceDeafen).toBe('Kuurouta tilassa');
  });

  it('uses a neutral reaction label when the viewer is part of a mixed list', () => {
    expect(chat.message.reactions.byMany).toBe('Reaktiot: {{names}}');
  });

  it('keeps Veyvox and Juno automatic labels distinct', () => {
    expect(common.language.automatic).toBe('Automaattinen (järjestelmä)');
    expect(voice.juno.settings.automatic).toBe('Automaattinen (Veyvox)');
    expect(voice.juno.settings.automaticDubbing).toBe(voice.juno.settings.automatic);
  });

  it('names a group direct message without addressing it as a person', () => {
    expect(dm.names.groupFallback).toBe('Ryhmä-YV');
  });

  it('keeps the rare Alzheimer card rule complete', () => {
    expect(voice.juno.memory.rules).toContain('Alzheimer');
    expect(voice.juno.faces.memory).toBe('Alzheimer');
  });

  it('uses a translated minute unit for AFK', () => {
    expect(spaces.settings.afk.minutes).toBe('min');
  });
});
