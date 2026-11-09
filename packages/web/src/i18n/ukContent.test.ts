import { describe, expect, it } from 'vitest';
import chat from '../locales/uk/chat.json';
import common from '../locales/uk/common.json';
import dm from '../locales/uk/dm.json';
import spaces from '../locales/uk/spaces.json';
import voice from '../locales/uk/voice.json';

describe('Ukrainian contextual content', () => {
  it('describes per-listener mute without claiming a server mute', () => {
    expect(voice.participantMenu.muteUser).toBe('Заглушити користувача');
    expect(spaces.mobile.muteUser).toBe('Заглушити користувача');
  });

  it('scopes Space moderation to the Space', () => {
    expect(voice.moderation.spaceMute).toBe('Заглушити в просторі');
    expect(voice.moderation.spaceDeafen).toBe('Вимкнути звук у просторі');
  });

  it('uses a neutral reaction label when the viewer is part of a mixed list', () => {
    expect(chat.message.reactions.byMany).toBe('Реакції: {{names}}');
  });

  it('keeps Veyvox and Juno automatic labels distinct', () => {
    expect(common.language.automatic).toBe('Автоматично (системна)');
    expect(voice.juno.settings.automatic).toBe('Автоматично (Veyvox)');
    expect(voice.juno.settings.automaticDubbing).toBe(voice.juno.settings.automatic);
  });

  it('names a group direct message without addressing it as a person', () => {
    expect(dm.names.groupFallback).toBe('Груповий чат');
  });

  it('keeps the rare Alzheimer card rule complete', () => {
    expect(voice.juno.memory.rules).toContain('Альцгеймера');
    expect(voice.juno.faces.memory).toBe('Альцгеймер');
  });

  it('uses a translated minute unit for AFK', () => {
    expect(spaces.settings.afk.minutes).toBe('хв');
  });
});
