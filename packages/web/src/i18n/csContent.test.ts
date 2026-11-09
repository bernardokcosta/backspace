import { describe, expect, it } from 'vitest';
import chat from '../locales/cs/chat.json';
import common from '../locales/cs/common.json';
import dm from '../locales/cs/dm.json';
import spaces from '../locales/cs/spaces.json';
import voice from '../locales/cs/voice.json';

describe('Czech contextual content', () => {
  it('describes per-listener mute without claiming a server mute', () => {
    expect(voice.participantMenu.muteUser).toBe('Ztlumit pro mě');
    expect(spaces.mobile.muteUser).toBe('Ztlumit uživatele');
  });

  it('scopes Space moderation to the Space', () => {
    expect(voice.moderation.spaceMute).toBe('Ztlumit v prostoru');
    expect(voice.moderation.spaceDeafen).toBe('Ohluchnout v prostoru');
  });

  it('uses a neutral reaction label when the viewer is part of a mixed list', () => {
    expect(chat.message.reactions.byMany).toBe('Reakce: {{names}}');
  });

  it('uses an invariant minute unit after every supplied AFK number', () => {
    expect(spaces.settings.afk.minutes).toBe('min');
  });

  it('keeps Veyvox and Juno automatic labels distinct', () => {
    expect(common.language.automatic).toBe('Automaticky (systém)');
    expect(voice.juno.settings.automatic).toBe('Automaticky (Veyvox)');
    expect(voice.juno.settings.automaticDubbing).toBe(voice.juno.settings.automatic);
  });

  it('names a group direct message without addressing it as a person', () => {
    expect(dm.names.groupFallback).toBe('Skupinová zpráva');
  });

  it('keeps the rare Alzheimer card rule complete', () => {
    expect(voice.juno.memory.rules).toContain('Alzheimer');
    expect(voice.juno.faces.memory).toBe('Alzheimer');
  });
});
