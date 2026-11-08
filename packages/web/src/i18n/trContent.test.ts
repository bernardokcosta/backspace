import { describe, expect, it } from 'vitest';
import admin from '../locales/tr/admin.json';
import chat from '../locales/tr/chat.json';
import common from '../locales/tr/common.json';
import dm from '../locales/tr/dm.json';
import errors from '../locales/tr/errors.json';
import settings from '../locales/tr/settings.json';
import spaces from '../locales/tr/spaces.json';
import voice from '../locales/tr/voice.json';

describe('Turkish contextual content', () => {
  it('keeps the informal second person consistent in the friends error', () => {
    expect(errors.already_friends).toBe('Zaten arkadaşsın.');
    expect(errors.already_friends).not.toContain('arkadaşsınız');
  });

  it('applies vowel harmony to the megabyte comparison', () => {
    expect(errors.icon_too_large).toContain("MB'den küçük");
    expect(errors.icon_too_large).not.toContain("MB'tan");
  });

  it('softens the consonant in the keep-current invite action', () => {
    expect(admin.invites.expiry.keepCurrent).toBe('Mevcudu koru');
  });

  it('labels revoke and expiry timestamps instead of bare actions', () => {
    expect(admin.invites.row.revokedAt).toBe('İptal tarihi');
    expect(admin.invites.row.expiredAt).toBe('Sona erme tarihi');
  });

  it('preserves the privacy direction of the activity setting', () => {
    expect(settings.privacy.activity.description).toContain('Başkalarının senin ne yaptığını görmelerine izin ver');
  });

  it('invites the player to take a seat', () => {
    expect(voice.juno.lobbyTitle).toBe('Bir koltuğa otur');
    expect(voice.juno.lobbyTitle).not.toBe('Bir koltuk çek');
  });

  it('names the forcing-SDR setting with a verbal noun', () => {
    expect(voice.streamSettings.forceSdr).toBe("SDR'ye zorlama");
  });

  it('declines the role noun with the correct accusative suffix', () => {
    expect(spaces.roles.copy).toBe('Rolü kopyala');
    expect(spaces.roles.delete).toBe('Rolü sil');
  });

  it('keeps the group DM term free of a possessive suffix', () => {
    expect(dm.names.groupFallback).toBe('Grup DM');
  });

  it('describes the close condition with drawing cards, not winning them', () => {
    expect(voice.juno.guide.reporting.detail).toContain('suçlanan kart aldığında veya ayrıldığında');
    expect(voice.juno.guide.reporting.detail).not.toContain('kart kazandığında');
  });

  it('makes the sticker capacity sentence grammatical', () => {
    expect(chat.stickers.capacityLimit_one).toBe('Koleksiyonunda {{count}} sticker daha eklemek için yer var.');
    expect(chat.stickers.capacityLimit_other).toBe(chat.stickers.capacityLimit_one);
  });

  it('distinguishes the Backspace key from the application name', () => {
    expect(voice.soundboard.shortcutHint).toContain('Geri silme tuşu (Backspace) bir kısayolu temizler.');
  });

  it('keeps Backspace and Juno automatic labels distinct', () => {
    expect(common.language.automatic).toBe('Otomatik (sistem)');
    expect(voice.juno.settings.automatic).toBe('Otomatik (Backspace)');
    expect(voice.juno.settings.automaticDubbing).toBe(voice.juno.settings.automatic);
  });

  it('scopes Space moderation to the Space instead of targeting it', () => {
    expect(voice.moderation.spaceMute).toBe('Bu alanda sessize al');
    expect(voice.moderation.spaceUnmute).toBe('Bu alanda sesi aç');
    expect(voice.moderation.spaceDeafen).toBe('Bu alanda sağırlaştır');
    expect(voice.moderation.spaceUndeafen).toBe('Bu alanda sağırlaştırmayı kaldır');
    expect(voice.moderation.spaceMute).not.toBe('Alanı sessize al');
  });

  it('closes the short report window when the accused draws cards', () => {
    expect(voice.juno.reportRules).toContain('kart almak, ayrılmak veya turun bitmesi pencereyi kapatır');
    expect(voice.juno.reportRules).not.toContain('kart kazanmak');
  });

  it('keeps the DM composer placeholder recipient-neutral for groups', () => {
    expect(spaces.main.dm.composerPlaceholder).toBe('Mesaj gönder: {{target}}');
    expect(spaces.main.dm.composerPlaceholder).not.toContain('adlı kişiye');
  });

  it('uses a neutral reaction label when the viewer is part of a mixed list', () => {
    expect(chat.message.reactions.byMany).toBe('Tepki verenler: {{names}}');
  });
});
