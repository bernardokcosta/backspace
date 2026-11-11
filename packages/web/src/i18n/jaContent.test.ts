import { describe, expect, it } from 'vitest';
import chat from '../locales/ja/chat.json';
import common from '../locales/ja/common.json';
import dm from '../locales/ja/dm.json';
import spaces from '../locales/ja/spaces.json';
import voice from '../locales/ja/voice.json';
import settings from '../locales/ja/settings.json';
import errors from '../locales/ja/errors.json';

describe('Japanese contextual content', () => {
  it('translates voice-channel prose and the bot-owned role completely', () => {
    expect(spaces.settings.members.rolesManagedByBot).toBe('ボット自身のロールはボットに残ります。');
    for (const value of [errors.space_afk_invalid_channel, errors.channel_type_invalid, errors.voice_connect_forbidden,
      spaces.channel.delete.descriptionVoice, spaces.settings.afk.hint, spaces.main.selectChannelHint, spaces.main.voice.empty,
      ...Object.values(voice.streamSettings.systemAudioNote)]) {
      expect(value).not.toContain('voice');
    }
    expect(errors.space_afk_invalid_channel).toContain('である必要があります');
    expect(errors.space_afk_invalid_timeout).toContain('である必要があります');
  });

  it('uses UI terms rather than a physical-interface noun', () => {
    expect(settings.interfaceScale.label).toBe('インターフェースの表示倍率');
    expect(settings.privacy.activity.game.unknownLabel).toBe('不明なWineプログラム');
  });

  it('describes per-listener mute without claiming a server mute', () => {
    expect(voice.participantMenu.muteUser).toBe('自分用にミュート');
    expect(spaces.mobile.muteUser).toBe(voice.participantMenu.muteUser);
  });

  it('scopes Space moderation to the Space', () => {
    expect(voice.moderation.spaceMute).toBe('スペースでミュート');
    expect(voice.moderation.spaceDeafen).toBe('スペースでデフェン');
  });

  it('uses a neutral reaction label when the viewer is part of a mixed list', () => {
    expect(chat.message.reactions.byMany).toBe('反応: {{names}}');
  });

  it('keeps Veyvox and Juno automatic labels distinct', () => {
    expect(common.language.automatic).toBe('自動 (システム)');
    expect(voice.juno.settings.automatic).toBe('自動 (Veyvox)');
    expect(voice.juno.settings.automaticDubbing).toBe(voice.juno.settings.automatic);
  });

  it('names a group direct message without addressing it as a person', () => {
    expect(dm.names.groupFallback).toBe('グループDM');
  });

  it('keeps the rare Alzheimer card rule complete', () => {
    expect(voice.juno.memory.rules).toContain('アルツハイマー');
    expect(voice.juno.faces.memory).toBe('アルツハイマー');
  });

  it('uses a translated minute unit for AFK', () => {
    expect(spaces.settings.afk.minutes).toBe('分');
  });
});
