import { describe, expect, it } from 'vitest';
import chat from '../locales/nb/chat.json';
import common from '../locales/nb/common.json';
import dm from '../locales/nb/dm.json';
import spaces from '../locales/nb/spaces.json';
import voice from '../locales/nb/voice.json';
import settings from '../locales/nb/settings.json';
import desktop from '../locales/nb/desktop.json';
import federation from '../locales/nb/federation.json';

describe('Norwegian Bokmål contextual content', () => {
  it('names the native joker card without translating wild as the adjective vill', () => {
    expect(voice.juno.faces.wild).toBe('Joker');
    expect(voice.juno.faces.draw4).toBe('Joker +4');
    expect(voice.juno.guide.examples.wild).toBe('Joker · velg en farge');
    for (const value of [voice.juno.guide.turn.match, voice.juno.guide.memory.play, voice.juno.memory.rules, voice.juno.rulesText]) {
      expect(value).not.toMatch(/\bwild\b/iu);
      expect(value).toContain('joker');
    }
  });

  it('describes issued credentials and software builds accurately', () => {
    for (const value of [federation.validation.connectHomeFirst, federation.connections.add.passwordHint, federation.connections.add.fallbackNotice.credentialRefused]) {
      expect(value).toContain('legitimasjon');
      expect(value).not.toContain('referanse');
    }
    expect(settings.desktop.updates.manualNote).toContain('Dette bygget');
    expect(desktop.update.available.body).toContain('Dette bygget');
    expect(desktop.update.available.bodyWithCurrent).toContain('Dette bygget');
  });

  it('uses chat-mention and notification labels that describe the actual controls', () => {
    expect(spaces.notifications.level.mentions).toBe('Bare @omtaler');
    expect(spaces.notifications.suppressRoles).toBe('Undertrykk rolleomtaler');
    expect(spaces.notifications.mute.indefinite).toBe('Til jeg slår på varsler igjen');
    expect(spaces.notifications.mutedIndefinitely).toBe('Dempet til du slår på varsler igjen');
    expect(voice.streamSettings.systemAudioStartFailed).toContain('Slå av Systemlyd');
  });

  it('describes per-listener mute without claiming a server mute', () => {
    expect(voice.participantMenu.muteUser).toBe('Demp for meg');
    expect(spaces.mobile.muteUser).toBe('Demp bruker');
  });

  it('scopes Space moderation to the Space', () => {
    expect(voice.moderation.spaceMute).toBe('Demp i rommet');
    expect(voice.moderation.spaceDeafen).toBe('Døv i rommet');
  });

  it('uses a neutral reaction label when the viewer is part of a mixed list', () => {
    expect(chat.message.reactions.byMany).toBe('Reaksjoner: {{names}}');
  });

  it('keeps Backspace and Juno automatic labels distinct', () => {
    expect(common.language.automatic).toBe('Automatisk (system)');
    expect(voice.juno.settings.automatic).toBe('Automatisk (Backspace)');
    expect(voice.juno.settings.automaticDubbing).toBe(voice.juno.settings.automatic);
  });

  it('names a group direct message without addressing it as a person', () => {
    expect(dm.names.groupFallback).toBe('Gruppe-DM');
  });

  it('keeps the rare Alzheimer card rule complete', () => {
    expect(voice.juno.memory.rules).toContain('Alzheimer');
    expect(voice.juno.faces.memory).toBe('Alzheimer');
  });

  it('uses a translated minute unit for AFK', () => {
    expect(spaces.settings.afk.minutes).toBe('min');
  });
});
