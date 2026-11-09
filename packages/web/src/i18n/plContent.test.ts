import { describe, expect, it } from 'vitest';
import chat from '../locales/pl/chat.json';
import common from '../locales/pl/common.json';
import dm from '../locales/pl/dm.json';
import spaces from '../locales/pl/spaces.json';
import voice from '../locales/pl/voice.json';

describe('Polish contextual content', () => {
  it('describes per-listener mute without claiming a server mute', () => {
    expect(voice.participantMenu.muteUser).toBe('Wycisz dla mnie');
    expect(spaces.mobile.muteUser).toBe('Wycisz użytkownika (lokalnie)');
    expect(voice.participantMenu.muteUser).not.toContain('przestrzeni');
  });

  it('scopes Space moderation to the Space', () => {
    expect(voice.moderation.spaceMute).toBe('Wycisz w przestrzeni');
    expect(voice.moderation.spaceDeafen).toBe('Ogłusz w przestrzeni');
  });

  it('uses a neutral reaction label when the viewer is part of a mixed list', () => {
    expect(chat.message.reactions.byMany).toBe('Reakcje: {{names}}');
  });

  it('uses an invariant minute unit after every supplied AFK number', () => {
    expect(spaces.settings.afk.minutes).toBe('min');
  });

  it('keeps Veyvox and Juno automatic labels distinct', () => {
    expect(common.language.automatic).toBe('Automatycznie (systemowy)');
    expect(voice.juno.settings.automatic).toBe('Automatycznie (Veyvox)');
    expect(voice.juno.settings.automaticDubbing).toBe(voice.juno.settings.automatic);
  });

  it('names a group direct message without addressing it as a person', () => {
    expect(dm.names.groupFallback).toBe('Grupowy DM');
  });

  it('keeps the rare Alzheimer card rule complete', () => {
    expect(voice.juno.memory.rules).toContain('Alzheimera');
    expect(voice.juno.faces.memory).toBe('Alzheimer');
  });
});
