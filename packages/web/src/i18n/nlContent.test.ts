import { describe, expect, it } from 'vitest';
import chat from '../locales/nl/chat.json';
import common from '../locales/nl/common.json';
import dm from '../locales/nl/dm.json';
import spaces from '../locales/nl/spaces.json';
import voice from '../locales/nl/voice.json';
import settings from '../locales/nl/settings.json';

describe('Dutch contextual content', () => {
  it('uses Dutch action words for muting', () => {
    expect(settings.keybinds.action.toggleMute).toBe('Dempen wisselen');
  });

  it('keeps the ranking rule scoped to players who finish the round', () => {
    expect(voice.juno.guide.score.ranking).toBe('De eerste lege hand wint. De overige spelers die de ronde afmaken, worden gerangschikt op resterende kaarten, inclusief eventuele pakstraf voor de laatste kaart.');
  });

  it('describes per-listener mute without claiming a server mute', () => {
    expect(voice.participantMenu.muteUser).toBe('Gebruiker dempen');
    expect(spaces.mobile.muteUser).toBe('Gebruiker dempen');
  });

  it('scopes Space moderation to the Space', () => {
    expect(voice.moderation.spaceMute).toBe('In ruimte dempen');
    expect(voice.moderation.spaceDeafen).toBe('In ruimte doven');
  });

  it('uses a neutral reaction label when the viewer is part of a mixed list', () => {
    expect(chat.message.reactions.byMany).toBe('Reacties: {{names}}');
  });

  it('keeps Veyvox and Juno automatic labels distinct', () => {
    expect(common.language.automatic).toBe('Automatisch (systeem)');
    expect(voice.juno.settings.automatic).toBe('Automatisch (Veyvox)');
    expect(voice.juno.settings.automaticDubbing).toBe(voice.juno.settings.automatic);
  });

  it('names a group direct message without addressing it as a person', () => {
    expect(dm.names.groupFallback).toBe('Groeps-DM');
  });

  it('keeps the rare Alzheimer card rule complete', () => {
    expect(voice.juno.memory.rules).toContain('Alzheimer');
    expect(voice.juno.faces.memory).toBe('Alzheimer');
  });

  it('uses a translated minute unit for AFK', () => {
    expect(spaces.settings.afk.minutes).toBe('min');
  });
});
