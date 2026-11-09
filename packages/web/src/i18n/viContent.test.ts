import { describe, expect, it } from 'vitest';
import chat from '../locales/vi/chat.json';
import common from '../locales/vi/common.json';
import dm from '../locales/vi/dm.json';
import spaces from '../locales/vi/spaces.json';
import voice from '../locales/vi/voice.json';
import uploads from '../locales/vi/uploads.json';

describe('Vietnamese contextual content', () => {
  it('uses the color-changing card name and distinguishes blue from green in examples', () => {
    expect(voice.juno.faces.wild).toBe('Đổi màu');
    expect(voice.juno.faces.draw4).toBe('Đổi màu +4');
    expect(voice.juno.guide.examples.top).toBe('5 xanh dương · bài cuối');
    expect(voice.juno.guide.examples.color).toBe('9 xanh dương · cùng màu');
    for (const value of [voice.juno.guide.turn.match, voice.juno.guide.memory.play, voice.juno.memory.rules, voice.juno.rulesText]) {
      expect(value).not.toMatch(/\bwild\b/iu);
      expect(value.toLocaleLowerCase('vi')).toContain('lá đổi màu');
    }
  });

  it('keeps the no-E2EE disclosure in the passive voice', () => {
    for (const value of [chat.list.welcome.group.federatedNotice, chat.list.welcome.dm.federatedNotice]) {
      expect(value).toContain('không được mã hóa đầu-cuối');
    }
  });

  it('describes software file references rather than physical handles', () => {
    for (const key of ['noDestination', 'destinationMissing', 'uploadHandleMissing', 'downloadHandleMissing'] as const) {
      expect(uploads.failure[key]).toContain('tham chiếu');
      expect(uploads.failure[key]).not.toContain('tay cầm');
    }
  });

  it('describes per-listener mute without claiming a server mute', () => {
    expect(voice.participantMenu.muteUser).toBe('Tắt tiếng cho tôi');
    expect(spaces.mobile.muteUser).toBe(voice.participantMenu.muteUser);
  });

  it('scopes Space moderation to the Space', () => {
    expect(voice.moderation.spaceMute).toBe('Tắt tiếng trong không gian');
    expect(voice.moderation.spaceDeafen).toBe('Điếc trong không gian');
  });

  it('uses a neutral reaction label when the viewer is part of a mixed list', () => {
    expect(chat.message.reactions.byMany).toBe('Cảm xúc: {{names}}');
  });

  it('keeps Veyvox and Juno automatic labels distinct', () => {
    expect(common.language.automatic).toBe('Tự động (hệ thống)');
    expect(voice.juno.settings.automatic).toBe('Tự động (Veyvox)');
    expect(voice.juno.settings.automaticDubbing).toBe(voice.juno.settings.automatic);
  });

  it('names a group direct message without addressing it as a person', () => {
    expect(dm.names.groupFallback).toBe('DM nhóm');
  });

  it('keeps the rare Alzheimer card rule complete', () => {
    expect(voice.juno.memory.rules).toContain('Alzheimer');
    expect(voice.juno.faces.memory).toBe('Alzheimer');
  });

  it('uses a translated minute unit for AFK', () => {
    expect(spaces.settings.afk.minutes).toBe('phút');
  });
});
