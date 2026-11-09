import { describe, expect, it } from 'vitest';
import ptAdmin from '../locales/pt/admin.json';
import ptSettings from '../locales/pt/settings.json';
import ptVoice from '../locales/pt/voice.json';
import { supportedLanguages } from './languages';
import { JUNO_DUBBINGS } from '../components/games/junoAssets';
import ruDesktop from '../locales/ru/desktop.json';
import zhDesktop from '../locales/zh/desktop.json';
import ruSettings from '../locales/ru/settings.json';
import zhSettings from '../locales/zh/settings.json';
import deCommon from '../locales/de/common.json';
import zhCommon from '../locales/zh/common.json';
import enAuth from '../locales/en/auth.json';
import ptAuth from '../locales/pt/auth.json';
import deAuth from '../locales/de/auth.json';
import ruAuth from '../locales/ru/auth.json';
import zhAuth from '../locales/zh/auth.json';
import zhDm from '../locales/zh/dm.json';
import ptDm from '../locales/pt/dm.json';
import ptSocial from '../locales/pt/social.json';
import ruFederation from '../locales/ru/federation.json';
import zhFederation from '../locales/zh/federation.json';
import ruDm from '../locales/ru/dm.json';
import enErrors from '../locales/en/errors.json';
import ptErrors from '../locales/pt/errors.json';
import deErrors from '../locales/de/errors.json';
import ruErrors from '../locales/ru/errors.json';
import zhErrors from '../locales/zh/errors.json';
import ruSocial from '../locales/ru/social.json';
import deSettings from '../locales/de/settings.json';
import enSettings from '../locales/en/settings.json';
import enAdmin from '../locales/en/admin.json';
import deAdmin from '../locales/de/admin.json';
import ruAdmin from '../locales/ru/admin.json';
import zhAdmin from '../locales/zh/admin.json';
import ptChat from '../locales/pt/chat.json';
import deChat from '../locales/de/chat.json';
import ruChat from '../locales/ru/chat.json';
import zhChat from '../locales/zh/chat.json';
import enSpaces from '../locales/en/spaces.json';
import ptSpaces from '../locales/pt/spaces.json';
import deSpaces from '../locales/de/spaces.json';
import ruSpaces from '../locales/ru/spaces.json';
import zhSpaces from '../locales/zh/spaces.json';
import enVoice from '../locales/en/voice.json';
import deVoice from '../locales/de/voice.json';
import ruVoice from '../locales/ru/voice.json';
import zhVoice from '../locales/zh/voice.json';

describe('contextual product terminology', () => {
  it('calls software bot accounts bots in Brazilian Portuguese', () => {
    expect(ptAdmin.users.filters.bot).toBe('Bots');
    expect(ptSettings.nav.tabs.bots).toBe('Contas de bot');
  });
  it('uses the German software-bot badge rather than a physical-robot noun', () => {
    expect(deCommon.actions.bot).toBe('BOT');
  });
  it('uses a recognizable Chinese color description for teal', () => {
    expect(zhCommon.colors.teal).toBe('蓝绿色');
  });
  it('has one Portuguese registry name shared by actual game media', () => {
    expect(supportedLanguages.filter(language => language.code === 'pt')).toHaveLength(1);
    expect(supportedLanguages.find(language => language.code === JUNO_DUBBINGS['pt-BR'].languageCode)?.nativeName).toBe('Português (Brasil)');
    expect(ptVoice.juno.settings.brazilianPortuguese).toBe('Português (Brasil)');
  });
  it('preserves action and special card category meanings, with Alzheimer as the special card name', () => {
    expect(ptVoice.juno.guide.sections.special).toBe('Cartas de ação');
    expect(ptVoice.juno.guide.sections.memory).toBe('Cartas especiais');
    expect(ptVoice.juno.faces.memory).toBe('Carta Alzheimer');
  });
  it('names the actual settings tab in translated update-install directions', () => {
    expect(ruDesktop.update.laterHint).toContain(ruSettings.nav.tabs.desktop);
    expect(zhDesktop.update.laterHint).toContain(zhSettings.nav.tabs.desktop);
  });
  it('states the actual ASCII username alphabet rather than implying accented letters are accepted', () => {
    for (const catalog of [enAuth, ptAuth, deAuth, ruAuth, zhAuth]) {
      expect(catalog.validation.usernameCharset).toContain('a–z');
      expect(catalog.validation.usernameCharset).toContain('0–9');
      expect(catalog.validation.usernameCharset).toContain('_');
    }
  });
  it('distinguishes an exhausted invitation limit from extending its expiry in Russian', () => {
    expect(ruAuth.register.invite.exhausted).toContain('увеличить лимит');
  });
  it('describes a target-specific credential naturally while retaining the Chinese password warning', () => {
    expect(zhAuth.join.connect.passwordNote).toBe('您的密码由主实例验证，绝不会发送给 {{host}}。该实例会收到专门为它生成的独立凭据。');
  });
  it('keeps general Chinese DM copy in the existing respectful register', () => {
    for (const value of [zhDm.callDelivery.acceptDropped, zhDm.callDelivery.rejectFailed, zhDm.callDelivery.endFailed,
      zhDm.callDelivery.awaitingApproval, zhDm.addMember.yourBots, zhDm.ownerActions.ownerNotListed]) {
      expect(value).not.toContain('你');
      expect(value).toContain('您');
    }
  });
  it('keeps the Portuguese removal toast neutral without parenthetical gender endings', () => {
    expect(ptDm.kick.success).toBe('Você removeu {{name}} do grupo');
  });
  it('describes discovery availability naturally in Portuguese', () => {
    expect(ptSocial.add.noDiscoverable).toBe('Ainda não há perfis disponíveis para descoberta. Convide pessoas para participar!');
  });
  it('retains the established Russian server term for a Veyvox deployment', () => {
    for (const value of [ruFederation.validation.selfInstance, ruFederation.validation.alreadyConnected,
      ruFederation.validation.connectHomeFirst, ruFederation.validation.authenticationFailed,
      ruDm.callDelivery.remoteInstance, ruDm.callDelivery.hostInstance, ruDm.callDelivery.voiceUnavailable]) expect(value).toContain('сервер');
    expect(ruFederation.admin.peer.rotateEvery_one).toBe('Раз в {{count}} день');
  });
  it('retains respectful Chinese federation copy and exact re-peer navigation labels', () => {
    for (const value of [zhFederation.validation.selfInstance, zhFederation.validation.notLoggedIn,
      zhFederation.validation.connectHomeFirst, zhFederation.feedback.pendingRequests_other,
      zhFederation.feedback.requestApproved, zhFederation.feedback.requestDenied, zhFederation.feedback.requestExpired]) {
      expect(value).not.toContain('你');
      expect(value).toContain('您');
    }
    expect(zhFederation.connections.add.passwordHint).toBe(zhAuth.join.connect.passwordNote);
    expect(zhFederation.admin.peer.reasonDetail.peer_reset_detected).toContain(zhFederation.admin.resetCleanup.repeer);
  });
  it('uses the same Latin username alphabet in wire-error copy as the input validation', () => {
    for (const catalog of [enErrors, ptErrors, deErrors, ruErrors, zhErrors]) {
      for (const key of ['username_invalid', 'username_characters_invalid', 'username_local_part_invalid', 'bot_name_invalid'] as const) {
        expect(catalog[key]).toContain('a–z');
        expect(catalog[key]).toContain('0–9');
      }
    }
  });
  it('does not confuse German deafen output with text-to-speech or a Space with a room', () => {
    expect(deErrors.soundboard_deafened).not.toContain('Sprachausgabe');
    expect(deErrors.soundboard_disabled).toContain('Space');
    expect(deErrors.soundboard_disabled).toContain('Soundboard');
  });
  it('distinguishes remote from local instances and uses the real Russian request tab', () => {
    expect(ruErrors.incoming_request_exists).toContain(ruSocial.tabs.pending);
    expect(ruErrors.PEER_REVOKED).toContain('Удалённый сервер');
    expect(deErrors.PEER_REVOKED).toContain('andere Instanz');
    expect(ruErrors.PEER_HANDSHAKE_IN_PROGRESS).not.toContain('через минуту');
  });
  it('describes file retention age and stale upload sessions rather than a person or only cancelled uploads', () => {
    expect(enErrors.cleanup_age_invalid).toContain('retention period');
    expect(ptErrors.cleanup_age_invalid).toContain('retenção');
    expect(deErrors.cleanup_age_invalid).toContain('Aufbewahrungsdauer');
    expect(deErrors.upload_session_cleanup_failed).toContain('Upload-Sitzungen');
    expect(ruErrors.upload_session_cleanup_failed).toContain('сеансов загрузки');
  });
  it('keeps the AFK channel inside a Space, not merely anywhere on its server', () => {
    expect(ptErrors.space_afk_invalid_channel).toContain('espaço');
    expect(deErrors.space_afk_invalid_channel).toContain('Space');
    expect(ruErrors.space_afk_invalid_channel).toContain('пространства');
    expect(zhErrors.space_afk_invalid_channel).toContain('空间');
  });
  it('translates visibility options instead of showing only wire enum values', () => {
    expect(deErrors.space_visibility_invalid).toContain('Beitritt auf Anfrage');
    expect(ruErrors.space_visibility_invalid).toContain('По запросу');
  });
  it('keeps bot instance terminology and managed-role lifecycle explicit', () => {
    for (const key of ['bots_native_only', 'bot_home_not_peered', 'bot_revocation_pending', 'bot_blocked', 'bot_block_not_federated'] as const) expect(ruErrors[key]).toContain('сервер');
    expect(enErrors.role_managed_by_bot).toContain('removed with it');
    expect(ptErrors.role_managed_by_bot).toContain('gerenciado');
    expect(deErrors.role_managed_by_bot).toContain('entfernt');
    expect(ruErrors.role_managed_by_bot).toContain('удаляется');
    expect(zhErrors.role_managed_by_bot).toContain('身份组');
  });
  it('distinguishes detached identities from a merely disconnected German session', () => {
    expect(deSettings.account.detached.notice).toContain('abgekoppelt');
  });
  it('names the actual Russian people-discovery heading and retains respectful Chinese settings prose', () => {
    expect(ruSettings.privacy.discovery.description).toContain(ruSocial.add.discover);
    expect(zhSettings.privacy.activity.game.description).not.toContain('你');
    expect(zhSettings.account.deletion.warning.spaces).toBe('您将退出所有空间');
  });
  it('keeps activity-game settings in the same respectful Chinese register', () => {
    for (const value of [zhSettings.privacy.activity.game.unknownDescription, zhSettings.privacy.activity.game.gamesLabel]) {
      expect(value).not.toContain('你');
      expect(value).toContain('您');
    }
  });
  it('names deafen and push-to-talk consistently with the native shortcut descriptions', () => {
    expect(ptSettings.keybinds.action.toggleDeafen).toBe('Ativar/desativar áudio');
    expect(ptSettings.keybinds.action.pushToTalk).toBe('Pressionar para falar');
    expect(zhSettings.keybinds.action.toggleDeafen).toBe('切换禁听状态');
    expect(zhSettings.keybinds.action.pushToTalk).toBe('按键说话');
    expect(deSettings.keybinds.action.toggleScreenShare).toContain('Bildschirmübertragung');
  });
  it('makes the viewer responsible for manual update installation, not the downloaded version itself', () => {
    expect(enSettings.desktop.updates.manualNote).toContain('Download new versions');
    expect(ptSettings.desktop.updates.manualNote).toContain('Baixe as novas versões');
  });
  it('shows the same actual Latin alphabet in bot creation hints as in validation errors', () => {
    for (const catalog of [enSettings, ptSettings, deSettings, ruSettings, zhSettings]) {
      expect(catalog.bots.create.hint).toContain('a–z');
      expect(catalog.bots.create.hint).toContain('0–9');
      expect(catalog.bots.create.hint).toContain('_');
    }
  });
  it('adds bots to a Space and names the actual developer settings tab', () => {
    expect(enSettings.bots.actions.addToServer).toBe(enSettings.bots.spaces.title);
    expect(deSettings.bots.actions.addToServer).toBe(deSettings.bots.spaces.title);
    expect(ruSettings.bots.actions.addToServer).toBe(ruSettings.bots.spaces.title);
    expect(zhSettings.bots.actions.addToServer).toBe(zhSettings.bots.spaces.title);
    expect(ptSettings.developer.mode.description).toContain(ptSettings.nav.tabs.bots);
    expect(deSettings.developer.mode.description).toContain(deSettings.nav.tabs.bots);
  });
  it('retains respectful Chinese bot settings and the managed-role term', () => {
    for (const value of [zhSettings.bots.description, zhSettings.bots.list.sectionTitle,
      zhSettings.bots.list.empty, zhSettings.bots.spaces.empty, zhSettings.developer.mode.description]) expect(value).not.toContain('你');
    expect(zhSettings.bots.permissions.hint).toContain('身份组');
  });
  it('distinguishes no invite expiration from an invalid invite and supports a neutral usage total', () => {
    expect(ptAdmin.invites.expiry.noExpiration).toBe('Sem expiração');
    expect(ruAdmin.invites.expiry.noExpiration).toBe('Без ограничения срока');
    expect(ptAdmin.invites.status.active).toBe('Ativo');
    for (const catalog of [enAdmin, ptAdmin, deAdmin, ruAdmin, zhAdmin]) expect(catalog.invites.row.usage).toMatch(/[:：]\s*\{\{usage\}\}/);
    expect(ptAdmin.invites.editModal.used).toBe('(usos: {{used}})');
  });
  it('does not claim that every lapsed invite expired rather than reaching its usage limit', () => {
    expect(ptAdmin.invites.reinstateModal.descriptionLapsed).not.toContain('expirou');
    expect(ruAdmin.invites.reinstateModal.descriptionLapsed).not.toContain('Срок действия');
    expect(zhAdmin.invites.redemptions.title).toContain('使用记录');
    expect(zhAdmin.invites.row.viewRedemptions).toContain('使用记录');
    expect(deAdmin.registration.description).toContain('Erstellung lokaler Konten');
  });
  it('describes dangling attachment records and retention durations, not pending jobs', () => {
    expect(ptAdmin.storage.overview.danglingRecords).toBe('Registros sem mensagem');
    expect(ptAdmin.storage.cleanup.nothingFound).toContain('sem mensagem');
    expect(ptAdmin.storage.stale.maxAge).toContain('retenção');
    expect(deAdmin.storage.stale.maxAge).toContain('Aufbewahrungsdauer');
    expect(zhAdmin.streaming.units.fps).toBe('{{value}} 帧/秒');
  });
  it('uses clear rate-limit and disabled-lookup copy, and consistent native instance terms', () => {
    expect(ptAdmin.updates.rateLimited.title).toBe('Limite de consultas do GitHub atingido');
    expect(zhAdmin.updates.noLookups).toBe('不执行检查');
    expect(ruAdmin.users.deleteDialog.blockBotHint).toContain('сервер');
    expect(ruAdmin.users.blockedBots.description).toContain('сервер');
    expect(deAdmin.users.deleteDialog.blockBotHint).toContain('Heimatinstanz');
  });
  it('identifies both home instances in Portuguese DM storage notices and describes recent messages naturally', () => {
    expect(ptChat.list.welcome.dm.federatedNotice).toContain('sua instância de origem');
    expect(ptChat.list.welcome.group.federatedNotice).toContain('sua instância de origem');
    expect(ptChat.list.jumpToPresent).toBe('Ir para as mensagens recentes');
  });
  it('avoids a refused-subcommand reference and gender placeholders in Russian system copy', () => {
    expect(ruChat.commands.subcommandRefused).toContain('Выберите подкоманду из списка');
    expect(ruChat.poke.received).toBe('{{actor}} толкает {{target}}');
    expect(ruChat.stickers.sourceInstance).toBe('Сервер');
    expect(ruChat.stickers.localInstance).toBe('Локальный сервер');
  });
  it('keeps ephemeral Chinese messages in the respectful chat register', () => {
    expect(zhChat.ephemeral.onlyYou).toContain('您');
    expect(zhChat.ephemeral.rowLabel).toContain('您');
    expect(zhChat.stickers.emptyHint).not.toContain('你');
  });
  it('preserves the sticker review reason, examples and actual discovery tab in translated review copy', () => {
    expect(ptChat.stickers.reviewNotes).toBe(ptChat.stickers.rejectReason);
    expect(deChat.stickers.reviewNotes).toBe(deChat.stickers.rejectReason);
    for (const catalog of [ptChat, deChat, ruChat, zhChat]) expect(catalog.stickers.pendingReviewHint).toContain(catalog.stickers.explore);
    expect(ptChat.stickers.rejectPlaceholder).toContain('qualidade');
    expect(deChat.stickers.rejectPlaceholder).toContain('Qualität');
    expect(ruChat.stickers.rejectPlaceholder).toContain('качество');
  });
  it('clarifies category visibility overrides and retrying failed invitations', () => {
    expect(enSpaces.category.settings.private.unhideOnSave).toContain('separate visibility restriction');
    expect(ptSpaces.category.settings.private.unhideOnSave).toContain('restrição de visibilidade própria');
    expect(deSpaces.category.settings.private.unhideOnSave).toContain('eigene Sichtbarkeitseinschränkung');
    expect(enSpaces.invite.retryFailed).toBe('Retry failed invites');
    expect(ruSpaces.invite.retryFailed).toContain('приглашения');
  });
  it('keeps Chinese invitation copy and credential boundaries consistent with auth', () => {
    expect(zhSpaces.inviteFriend.intro).not.toContain('你');
    expect(zhSpaces.inviteFriend.noSpaces).not.toContain('你');
    expect(zhSpaces.join.connect.passwordNote).toBe(zhAuth.join.connect.passwordNote);
    expect(deSpaces.soundboardTab).toBe('Soundboard');
  });
  it('keeps bot invitation warnings scoped to the Space and uses consistent managed-role terms', () => {
    expect(enSpaces.settings.members.botInvite.warning).toContain('this space');
    expect(deSpaces.settings.members.botInvite.warning).toContain('Space');
    expect(ruSpaces.settings.members.botInvite.warning).toContain('пространства');
    expect(zhSpaces.settings.members.botInvite.warning).toContain('空间');
    expect(enSpaces.roles.managedByBot).toContain('deleted manually');
    expect(ptSpaces.roles.managedByBot).toContain('removido');
    expect(zhSpaces.roles.managedByBot).toContain('身份组');
    expect(zhSpaces.settings.members.rolesManagedByBot).toContain('身份组');
    for (const value of [zhSpaces.settings.members.botInvite.warning, zhSpaces.settings.members.botInvite.permissionsIntro,
      zhSpaces.settings.members.botInvite.permissionsUnheld]) expect(value).not.toContain('你');
  });
  it('describes deafen voice output with the same Portuguese and Chinese terminology as shortcuts', () => {
    expect(ptSpaces.permissions.names.deafenMembers).toBe('Desativar áudio dos membros');
    expect(zhSpaces.permissions.names.deafenMembers).toBe('将成员设为禁听');
  });
  it('does not claim leaving a Space requires a newly generated invite link', () => {
    expect(enSpaces.sidebar.space.leaveConfirm.description).not.toContain('new invite');
    expect(ptSpaces.sidebar.space.leaveConfirm.description).not.toContain('novo convite');
    expect(deSpaces.sidebar.space.leaveConfirm.description).not.toContain('neue Einladung');
    expect(ruSpaces.sidebar.space.leaveConfirm.description).not.toContain('новое приглашение');
    expect(zhSpaces.sidebar.space.leaveConfirm.description).not.toContain('新的邀请');
  });
  it('uses the same deafen-output terms throughout the Portuguese and Chinese sidebar', () => {
    expect(ptSpaces.sidebar.userArea.deafen).toBe('Desativar áudio');
    expect(ptSpaces.sidebar.userArea.undeafen).toBe('Ativar áudio');
    expect(ptSpaces.sidebar.userArea.spaceDeafened).toBe('Áudio desativado no espaço');
    expect(zhSpaces.sidebar.userArea.deafen).toBe('禁听');
    expect(zhSpaces.sidebar.userArea.undeafen).toBe('取消禁听');
    expect(zhSpaces.sidebar.userArea.spaceDeafened).toBe('已被空间禁听');
    expect(deSpaces.sidebar.userArea.voiceSettings).toContain('Video');
  });
  it('retains respectful Chinese nickname and notification copy', () => {
    for (const value of [zhSpaces.members.nickname.descriptionSelf, zhSpaces.notifications.dmNote,
      zhSpaces.notifications.mutedIndefinitely, zhSpaces.notifications.massNote]) expect(value).not.toContain('你');
  });
  it('keeps Juno ranking scoped to the named German Space and navigation labels consistent', () => {
    expect(deVoice.juno.rankingTitle).toContain('Space');
    expect(deVoice.juno.emptyRanking).toContain('Space');
    expect(deVoice.juno.rankingUnavailable).toContain('Space');
    expect(deVoice.juno.scoreHint).toContain('Space');
    expect(deVoice.juno.guide.table.leave).toContain('Kachelansicht');
    expect(zhVoice.juno.guide.table.leave).toContain('返回网格');
  });
  it('describes a failed blind attempt without claiming the hidden card was a color mismatch', () => {
    expect(enVoice.juno.memory.miss).toContain('blind attempt');
    expect(ptVoice.juno.memory.miss).toContain('às cegas');
    expect(deVoice.juno.memory.miss).toContain('blinden Versuch');
    expect(ruVoice.juno.memory.miss).toContain('вслепую');
    expect(zhVoice.juno.memory.miss).toContain('盲打');
    expect(zhVoice.juno.faces.memory).toContain('Alzheimer');
    expect(zhVoice.juno.memory.title).toBe('模糊记忆');
  });
  it('uses established German Soundboard and Space terms and distinguishes Russian self mute from deafen', () => {
    expect(deVoice.soundboard.title).toBe(deSpaces.soundboardTab);
    expect(deVoice.soundboard.manageDescription).toContain('Space');
    expect(deVoice.soundboard.disabled).toBe(deErrors.soundboard_disabled);
    expect(deVoice.soundboard.enabled).toContain('Soundboard');
    expect(ruVoice.soundboard.cannotPlay).toContain('Микрофон не должен быть отключён модератором');
    expect(zhVoice.soundboard.cannotPlay).toContain('禁听');
    expect(zhVoice.soundboard.description).not.toContain('你');
  });
  it('keeps voice moderation badges and actions consistent with the sidebar deafen terms', () => {
    expect(ptVoice.badges.spaceDeafened).toBe(ptSpaces.sidebar.userArea.spaceDeafened);
    expect(ptVoice.moderation.spaceDeafen).toBe('Desativar áudio no espaço');
    expect(ptVoice.moderation.spaceUndeafen).toBe('Ativar áudio no espaço');
    expect(zhVoice.badges.spaceDeafened).toBe(zhSpaces.sidebar.userArea.spaceDeafened);
    expect(zhVoice.moderation.spaceDeafen).toBe('空间禁听');
    expect(zhVoice.moderation.spaceUndeafen).toBe('解除空间禁听');
    for (const value of [zhVoice.feedback.micDeniedListener, zhVoice.feedback.joinedOtherSession]) expect(value).not.toContain('你');
  });
  it('does not strengthen the borderless-capture guarantee warning into a claim of absent support', () => {
    expect(ptVoice.screenPicker.borderless.unsupported).toContain('garantir');
    expect(deVoice.screenPicker.borderless.unsupported).toContain('garantieren');
    expect(ruVoice.screenPicker.borderless.unsupported).toContain('гарантировать');
    expect(zhVoice.screenPicker.borderless.unsupported).toContain('保证');
  });
  it('keeps voice controls, frame-rate units and named microphone actions consistent', () => {
    expect(ptVoice.controls.deafen).toBe(ptSpaces.sidebar.userArea.deafen);
    expect(ptVoice.controls.undeafen).toBe(ptSpaces.sidebar.userArea.undeafen);
    expect(ptVoice.controls.deafenShortcut).toBe('Desativar áudio (D)');
    expect(ptVoice.controls.undeafenShortcut).toBe('Ativar áudio (D)');
    expect(zhVoice.controls.deafen).toBe(zhSpaces.sidebar.userArea.deafen);
    expect(zhVoice.controls.undeafen).toBe(zhSpaces.sidebar.userArea.undeafen);
    expect(zhVoice.controls.deafenShortcut).toBe('禁听 (D)');
    expect(zhVoice.controls.undeafenShortcut).toBe('取消禁听 (D)');
    expect(zhVoice.stream.qualityValue).toBe('{{height}}p {{fps}} 帧/秒');
    expect(zhVoice.feedback.micDeniedListener).toContain(zhVoice.mobileCall.micDenied.allow);
    expect(deVoice.controls.shareOptions).toContain('Bildschirmübertragung');
    expect(zhVoice.channelDuration).toContain('通话');
    for (const value of [zhVoice.streamSettings.systemAudioNote.excluded, zhVoice.streamSettings.systemAudioNote.excludedMac]) expect(value).not.toContain('你');
  });
});
