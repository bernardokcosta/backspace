import { describe, expect, it } from 'vitest';
import admin from '../locales/es/admin.json';
import auth from '../locales/es/auth.json';
import chat from '../locales/es/chat.json';
import common from '../locales/es/common.json';
import dm from '../locales/es/dm.json';
import errors from '../locales/es/errors.json';
import federation from '../locales/es/federation.json';
import settings from '../locales/es/settings.json';
import social from '../locales/es/social.json';
import spaces from '../locales/es/spaces.json';
import voice from '../locales/es/voice.json';

describe('Spanish contextual content', () => {
  it('identifies the tus protocol without making it sound like the possessive tus', () => {
    expect(admin.storage.stale.description).toContain('protocolo tus');
    expect(admin.storage.stale.description).toContain('<code>.tus/</code>');
    expect(admin.storage.stale.description).toContain('DELETE');
  });

  it('uses count-neutral cleanup labels for interpolated singular or plural noun phrases', () => {
    const summary = federation.admin.resetCleanup.eventSummary;
    expect(summary).toContain('Limpieza automática: {{identities}}');
    expect(summary).toContain('desvinculación de cuentas con contenido local: {{accounts}}');
    expect(summary).not.toContain('se han limpiado automáticamente {{identities}}');
    expect(summary).toContain('conservan el acceso con su contraseña actual');
  });

  it('uses plural agreement when deleting a channel together with all its messages', () => {
    for (const value of [spaces.channel.delete.description, spaces.channel.delete.descriptionVoice,
      spaces.channels.deleteConfirm.description]) expect(value).toContain('Se eliminarán');
  });

  it('names the notification action without an ambiguous plural pronoun', () => {
    expect(spaces.notifications.mute.indefinite).toBe('Hasta reactivar notificaciones');
    expect(spaces.notifications.unmute).toBe('Reactivar notificaciones');
  });

  it('shares password-isolation warnings across all three connection surfaces', () => {
    expect(auth.join.connect.passwordNote).toBe(spaces.join.connect.passwordNote);
    expect(auth.join.connect.passwordNote).toBe(federation.connections.add.passwordHint);
    expect(auth.join.connect.passwordNote).toContain('nunca la envía a {{host}}');
    expect(chat.list.welcome.dm.federatedNotice).toContain('No están cifrados de extremo a extremo');
    expect(chat.list.welcome.group.federatedNotice).toContain('No están cifrados de extremo a extremo');
  });

  it('uses software bot names and explicit Latin account-name alphabets', () => {
    expect(settings.bots.title).toBe(settings.nav.tabs.bots);
    expect(admin.users.filters.bot).toBe(settings.bots.title);
    expect(settings.developer.mode.description).toContain(settings.nav.tabs.bots);
    expect(settings.bots.actions.addToServer).toBe(settings.bots.spaces.title);
    expect(spaces.settings.members.botInvite.warning).toContain('este espacio');
    for (const value of [auth.validation.usernameCharset, settings.bots.create.hint,
      errors.username_invalid, errors.username_characters_invalid, errors.bot_name_invalid]) {
      expect(value).toContain('a–z');
      expect(value).toContain('0–9');
      expect(value).toContain('_');
    }
  });

  it('distinguishes microphone mute, disabled voice output and disabled notifications', () => {
    expect(voice.controls.mute).toBe(spaces.sidebar.userArea.mute);
    expect(voice.controls.unmute).toBe(spaces.sidebar.userArea.unmute);
    expect(voice.controls.deafen).toBe(spaces.sidebar.userArea.deafen);
    expect(voice.controls.undeafen).toBe(spaces.sidebar.userArea.undeafen);
    expect(voice.badges.spaceDeafened).toBe(spaces.sidebar.userArea.spaceDeafened);
    expect(voice.soundboard.cannotPlay).toContain('silenciado por moderación');
    expect(voice.soundboard.disabled).toBe(errors.soundboard_disabled);
    expect(voice.soundboard.title).toBe(spaces.soundboardTab);
    expect(voice.feedback.micDeniedListener).toContain(voice.mobileCall.micDenied.allow);
    expect(voice.micPrearm.denied).toContain(voice.mobileCall.micDenied.allow);
  });

  it('keeps automatic system and automatic game preferences semantically distinct', () => {
    expect(common.language.automatic).toBe('Automático (sistema)');
    expect(voice.juno.settings.automatic).toBe('Automático (Veyvox)');
    expect(voice.juno.settings.automaticDubbing).toBe(voice.juno.settings.automatic);
  });

  it('uses Spanish draw terminology, action and special categories, and the supplied card name', () => {
    expect(voice.juno.draw).toBe('Robar una');
    expect(voice.juno.guide.turn.draw).toContain('robar');
    expect(voice.juno.guide.sections.special).toBe('Cartas de acción');
    expect(voice.juno.guide.sections.memory).toBe('Cartas especiales');
    expect(voice.juno.faces.memory).toBe('Alzheimer');
    expect(voice.juno.guide.memory.intro).toContain('Alzheimer');
    expect(voice.juno.memory.miss).toContain('intento a ciegas');
    expect(voice.juno.memory.miss).not.toContain('color');
    expect(voice.juno.memory.hiddenCard).toBe('Carta oculta {{number}}');
    expect(voice.juno.guide.table.leave).toContain(voice.juno.mosaic);
    expect(voice.juno.reportRules).toContain('Sin denuncia no hay penalización');
    expect(voice.juno.guide.score.practice).toContain('aunque el bot salga');
  });

  it('uses a grammatical unnamed group composer and matching sticker discovery labels', () => {
    expect(spaces.main.dm.composerPlaceholder.replace('{{target}}', dm.names.theGroup)).toBe('Mensaje para el grupo');
    expect(chat.stickers.pendingReviewHint).toContain(chat.stickers.explore);
    expect(chat.stickers.reviewNotes).toBe(chat.stickers.rejectReason);
    expect(settings.privacy.discovery.description).toContain(social.add.discover);
  });

  it('retains safety qualifiers, real units and the distinction between lapsed and revoked invites', () => {
    expect(voice.screenPicker.borderless.unsupported).toContain('no puede garantizar');
    expect(voice.stream.qualityValue).toContain('fps');
    expect(voice.streamSettings.systemAudioNote.includedWindows).toContain('oirán sus propias voces');
    expect(admin.invites.reinstateModal.descriptionLapsed).toContain('misma URL');
    expect(admin.invites.reinstateModal.descriptionRevoked).toContain('URL distinta');
    expect(admin.invites.expiry.noExpiration).toBe('Sin caducidad');
    expect(admin.updates.available.manualWarning).toContain('<code>--remove-orphans</code>');
  });
});
