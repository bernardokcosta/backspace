import { describe, expect, it } from 'vitest';
import chat from '../locales/ar/chat.json';
import common from '../locales/ar/common.json';
import dm from '../locales/ar/dm.json';
import spaces from '../locales/ar/spaces.json';
import voice from '../locales/ar/voice.json';
import admin from '../locales/ar/admin.json';
import errors from '../locales/ar/errors.json';
import federation from '../locales/ar/federation.json';

describe('Arabic contextual content', () => {
  it('labels the unread action as unread rather than read', () => {
    expect(chat.menu.markUnread).toBe('تعليم كغير مقروءة');
  });

  it('keeps the Arabic percent sign after its numeric value in logical order', () => {
    expect(common.units.percent).toBe('{{value}}٪');
  });

  it('translates the reset instruction and federation prose completely', () => {
    expect(admin.streaming.matrix.cellDefault).toBe('افتراضي: {{value}} (انقر × لإعادة الضبط)');
    for (const value of [errors.peer_rejected, errors.peer_pending_approval, errors.peer_pending_local_admin, errors.PEER_REVOKED, federation.connections.empty]) {
      expect(value).not.toContain('الفدرation');
      expect(value).toContain('الفدرالية');
    }
  });

  it('asks for voice-chat audio without duplicating the audio noun', () => {
    expect(errors.soundboard_deafened).toBe('فعّل صوت المحادثة قبل تشغيل صوت.');
  });

  it('describes per-listener mute without claiming a server mute', () => {
    expect(voice.participantMenu.muteUser).toBe('كتم المستخدم');
    expect(spaces.mobile.muteUser).toBe('كتم المستخدم');
  });

  it('scopes Space moderation to the Space', () => {
    expect(voice.moderation.spaceMute).toBe('كتم في المساحة');
    expect(voice.moderation.spaceDeafen).toBe('صم في المساحة');
  });

  it('uses a neutral reaction label when the viewer is part of a mixed list', () => {
    expect(chat.message.reactions.byMany).toBe('التفاعلات: {{names}}');
  });

  it('keeps Backspace and Juno automatic labels distinct', () => {
    expect(common.language.automatic).toBe('تلقائي (النظام)');
    expect(voice.juno.settings.automatic).toBe('تلقائي (Backspace)');
    expect(voice.juno.settings.automaticDubbing).toBe(voice.juno.settings.automatic);
  });

  it('names a group direct message without addressing it as a person', () => {
    expect(dm.names.groupFallback).toBe('رسائل المجموعة');
  });

  it('keeps the rare Alzheimer card rule complete', () => {
    expect(voice.juno.memory.rules).toContain('ألزهايمر');
    expect(voice.juno.faces.memory).toBe('ألزهايمر');
  });

  it('uses a translated minute unit for AFK', () => {
    expect(spaces.settings.afk.minutes).toBe('د');
  });
});
