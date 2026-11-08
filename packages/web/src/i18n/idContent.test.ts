import { describe, expect, it } from 'vitest';
import chat from '../locales/id/chat.json';
import common from '../locales/id/common.json';
import dm from '../locales/id/dm.json';
import spaces from '../locales/id/spaces.json';
import voice from '../locales/id/voice.json';
import settings from '../locales/id/settings.json';
import path from 'node:path';
import { readDesktopCatalogs } from '../../../../scripts/i18n/desktop.mjs';

describe('Indonesian contextual content', () => {
  it('names on/off actions in Indonesian rather than transfer or English toggle labels', () => {
    expect(settings.keybinds.action.toggleMute).toBe('Bisukan/Bunyikan');
    expect(settings.keybinds.action.toggleDeafen).toBe('Tulikan/Dengarkan');
    expect(settings.keybinds.action.toggleCamera).toBe('Nyalakan/Matikan Kamera');
    expect(settings.keybinds.action.toggleScreenShare).toBe('Bagikan/Henti Berbagi Layar');
    const catalogs = readDesktopCatalogs(path.resolve(import.meta.dirname, '../../../..')).catalogs;
    const main = catalogs.find((catalog: { language: string; surface: string }) => catalog.language === 'id' && catalog.surface === 'main')!.values;
    expect(main['shortcut.toggleMute']).toBe('Bisukan/Bunyikan Mikrofon');
    expect(main['shortcut.toggleDeafen']).toBe('Tulikan/Dengarkan');
    expect(main['shortcut.toggleCamera']).toBe('Nyalakan/Matikan Kamera');
    expect(main['shortcut.toggleScreenShare']).toBe('Bagikan/Henti Berbagi Layar');
  });

  it('completes the instruction to cancel an instance switch and stay here', () => {
    const catalogs = readDesktopCatalogs(path.resolve(import.meta.dirname, '../../../..')).catalogs;
    const picker = catalogs.find((catalog: { language: string; surface: string }) => catalog.language === 'id' && catalog.surface === 'instancePicker')!.values;
    expect(picker.switchSubtitle).toBe('Hubungkan ke instans Backspace lain, atau batalkan untuk tetap di sini.');
  });

  it('describes per-listener mute without claiming a server mute', () => {
    expect(voice.participantMenu.muteUser).toBe('Bisukan untuk saya');
    expect(spaces.mobile.muteUser).toBe('Bisukan Pengguna');
  });

  it('scopes Space moderation to the Space', () => {
    expect(voice.moderation.spaceMute).toBe('Bisukan di ruang');
    expect(voice.moderation.spaceDeafen).toBe('Tulikan di ruang');
  });

  it('uses a neutral reaction label when the viewer is part of a mixed list', () => {
    expect(chat.message.reactions.byMany).toBe('Reaksi: {{names}}');
  });

  it('keeps Backspace and Juno automatic labels distinct', () => {
    expect(common.language.automatic).toBe('Otomatis (sistem)');
    expect(voice.juno.settings.automatic).toBe('Otomatis (Backspace)');
    expect(voice.juno.settings.automaticDubbing).toBe(voice.juno.settings.automatic);
  });

  it('names a group direct message without addressing it as a person', () => {
    expect(dm.names.groupFallback).toBe('DM Grup');
  });

  it('keeps the rare Alzheimer card rule complete', () => {
    expect(voice.juno.memory.rules).toContain('Alzheimer');
    expect(voice.juno.faces.memory).toBe('Alzheimer');
  });

  it('uses a translated minute unit for AFK', () => {
    expect(spaces.settings.afk.minutes).toBe('mnt');
  });
});
