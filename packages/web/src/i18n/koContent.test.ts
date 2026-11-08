import { describe, expect, it } from 'vitest';
import chat from '../locales/ko/chat.json';
import common from '../locales/ko/common.json';
import dm from '../locales/ko/dm.json';
import spaces from '../locales/ko/spaces.json';
import voice from '../locales/ko/voice.json';
import settings from '../locales/ko/settings.json';
import admin from '../locales/ko/admin.json';

describe('Korean contextual content', () => {
  it('names the keyboard spacebar rather than a product Space', () => {
    expect(settings.keybinds.key.space).toBe('스페이스바');
  });

  it('separates the GIF setup instructions into readable sentences', () => {
    expect(admin.general.gif.description).toBe('Klipy를 통한 GIF 검색 활성화. Klipy 개발자 포털에서 무료 API 키 받기.');
  });

  it('describes per-listener mute without claiming a server mute', () => {
    expect(voice.participantMenu.muteUser).toBe('나에게 음소거');
    expect(spaces.mobile.muteUser).toBe('사용자 음소거');
  });

  it('scopes Space moderation to the Space', () => {
    expect(voice.moderation.spaceMute).toBe('스페이스에서 음소거');
    expect(voice.moderation.spaceDeafen).toBe('스페이스에서 청각 차단');
  });

  it('uses a neutral reaction label when the viewer is part of a mixed list', () => {
    expect(chat.message.reactions.byMany).toBe('반응: {{names}}');
  });

  it('keeps Backspace and Juno automatic labels distinct', () => {
    expect(common.language.automatic).toBe('자동 (시스템)');
    expect(voice.juno.settings.automatic).toBe('자동 (Backspace)');
    expect(voice.juno.settings.automaticDubbing).toBe(voice.juno.settings.automatic);
  });

  it('names a group direct message without addressing it as a person', () => {
    expect(dm.names.groupFallback).toBe('그룹 DM');
  });

  it('keeps the rare Alzheimer card rule complete', () => {
    expect(voice.juno.memory.rules).toContain('알츠하이머');
    expect(voice.juno.faces.memory).toBe('알츠하이머');
  });

  it('uses a translated minute unit for AFK', () => {
    expect(spaces.settings.afk.minutes).toBe('분');
  });
});
