import { describe, expect, it } from 'vitest';
import chat from '../locales/da/chat.json';
import common from '../locales/da/common.json';
import dm from '../locales/da/dm.json';
import spaces from '../locales/da/spaces.json';
import voice from '../locales/da/voice.json';
import admin from '../locales/da/admin.json';

describe('Danish contextual content', () => {
  it('keeps complete native setup instructions', () => {
    expect(common.language.description).toContain('. Andres beskeder');
    expect(admin.streaming.matrix.scaleHint).toBe('Træk for at skalere alle bitrates. Finjustér enkelte celler nedenfor.');
  });

  it('describes per-listener mute without claiming a server mute', () => {
    expect(voice.participantMenu.muteUser).toBe('Mute for mig');
    expect(spaces.mobile.muteUser).toBe('Mute bruger');
  });

  it('scopes Space moderation to the Space', () => {
    expect(voice.moderation.spaceMute).toBe('Mute i rummet');
    expect(voice.moderation.spaceDeafen).toBe('Døv i rummet');
  });

  it('uses a neutral reaction label when the viewer is part of a mixed list', () => {
    expect(chat.message.reactions.byMany).toBe('Reaktioner: {{names}}');
  });

  it('keeps Veyvox and Juno automatic labels distinct', () => {
    expect(common.language.automatic).toBe('Automatisk (system)');
    expect(voice.juno.settings.automatic).toBe('Automatisk (Veyvox)');
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
