import { describe, expect, it } from 'vitest';
import chat from '../locales/th/chat.json';
import common from '../locales/th/common.json';
import dm from '../locales/th/dm.json';
import spaces from '../locales/th/spaces.json';
import voice from '../locales/th/voice.json';

describe('Thai contextual content', () => {
  it('uses the complete failure word in the save fallback', () => {
    expect(common.states.saveFailed).toBe('บันทึกล้มเหลว');
  });

  it('keeps the Thai tone mark in both space-scoped XP explanations', () => {
    for (const value of [voice.juno.guide.score.practice, voice.juno.scoreHint]) {
      expect(value).toContain('อยู่สเปซนี้');
      expect(value).not.toContain('อยูสเปซนี้');
    }
  });

  it('describes per-listener mute without claiming a server mute', () => {
    expect(voice.participantMenu.muteUser).toBe('ปิดเสียงสำหรับฉัน');
    expect(spaces.mobile.muteUser).toBe('ปิดเสียงผู้ใช้');
  });

  it('scopes Space moderation to the Space', () => {
    expect(voice.moderation.spaceMute).toBe('ปิดเสียงในสเปซ');
    expect(voice.moderation.spaceDeafen).toBe('หูหนวกในสเปซ');
  });

  it('uses a neutral reaction label when the viewer is part of a mixed list', () => {
    expect(chat.message.reactions.byMany).toBe('ปฏิกิริยา: {{names}}');
  });

  it('keeps Veyvox and Juno automatic labels distinct', () => {
    expect(common.language.automatic).toBe('อัตโนมัติ (ระบบ)');
    expect(voice.juno.settings.automatic).toBe('อัตโนมัติ (Veyvox)');
    expect(voice.juno.settings.automaticDubbing).toBe(voice.juno.settings.automatic);
  });

  it('names a group direct message without addressing it as a person', () => {
    expect(dm.names.groupFallback).toBe('DM กลุ่ม');
  });

  it('keeps the rare Alzheimer card rule complete', () => {
    expect(voice.juno.memory.rules).toContain('อัลไซเมอร์');
    expect(voice.juno.faces.memory).toBe('อัลไซเมอร์');
  });

  it('uses a translated minute unit for AFK', () => {
    expect(spaces.settings.afk.minutes).toBe('นาที');
  });
});
