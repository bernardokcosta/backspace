import { describe, expect, it } from 'vitest';
import auth from '../locales/fr/auth.json';
import common from '../locales/fr/common.json';
import search from '../locales/fr/search.json';
import chat from '../locales/fr/chat.json';
import admin from '../locales/fr/admin.json';
import settings from '../locales/fr/settings.json';
import social from '../locales/fr/social.json';
import spaces from '../locales/fr/spaces.json';
import voice from '../locales/fr/voice.json';

describe('French contextual content', () => {
  it('names an unrestricted content filter rather than requiring all content types', () => {
    expect(search.filters.has.any).toBe('Indifférent');
  });

  it('keeps the remaining-results label grammatical even when one result remains', () => {
    expect(search.results.loadMore).toBe('Charger la suite ({{remaining}} à charger)');
  });

  it('does not imply that a selected registration invite has already been redeemed', () => {
    expect(auth.register.invite.using).toBe('Avec l’invitation : {{name}}');
  });

  it('preserves system automatic and native username validation meanings', () => {
    expect(common.language.automatic).toBe('Automatique (système)');
    expect(auth.validation.usernameCharset).toContain('a–z');
    expect(auth.validation.usernameCharset).toContain('0–9');
  });

  it('uses a neutral reaction phrase that also agrees when the list includes Toi', () => {
    expect(chat.message.reactions.byMany).toBe('Réactions : {{names}}');
  });

  it('retains the real admin safety boundaries and the revoked-versus-lapsed invite distinction', () => {
    expect(admin.invites.reinstateModal.descriptionLapsed).toContain('même URL');
    expect(admin.invites.reinstateModal.descriptionRevoked).toContain('URL différente');
    expect(admin.storage.stale.description).toContain('protocole tus');
    expect(admin.updates.noLookups).toBe('Consultations désactivées');
    expect(admin.updates.available.manualWarning).toContain('<code>--remove-orphans</code>');
  });

  it('describes disabling the developer mode as hiding tools, not disabling their bots', () => {
    expect(settings.developer.mode.description).toContain('Désactiver ce mode');
    expect(settings.developer.mode.description).toContain('tes bots continuent de fonctionner');
    expect(settings.developer.mode.description).toContain(settings.nav.tabs.bots);
  });

  it('keeps settings scopes, discoverability and software-bot terms consistent', () => {
    expect(settings.bots.title).toBe(settings.nav.tabs.bots);
    expect(settings.bots.actions.addToServer).toBe(settings.bots.spaces.title);
    expect(settings.bots.create.hint).toContain('a–z');
    expect(settings.bots.token.warning).toContain('quiconque le possède contrôle le bot');
    expect(settings.privacy.discovery.description).toContain(social.add.discover);
    expect(settings.account.deletion.warning.messages).toContain('conservés');
  });

  it('states the category unhide result without stacking postpositive modifiers', () => {
    expect(spaces.category.settings.private.unhideOnSave).toBe(
      'Enregistrer rendra cette catégorie visible par tous les membres, y compris ses canaux qui n’ont pas leur propre restriction de visibilité.',
    );
  });

  it('uses complete permission sentences in the voice device menu', () => {
    expect(spaces.sidebar.userArea.microphonePermission).toBe('L’autorisation du micro est nécessaire.');
    expect(spaces.sidebar.userArea.audioPermission).toBe('L’autorisation audio est nécessaire.');
  });

  it('keeps the ranking column label consistent with the rank wording in the scoring rules', () => {
    expect(voice.juno.rank).toBe('Rang');
    expect(voice.juno.scoreRules).toContain('partagent rang et XP');
  });

  it('attributes the missed JUNO report to the reported player, not to JUNO', () => {
    expect(voice.juno.reportConfirmed).toBe(
      '{{reporter}} a signalé que {{target}} avait oublié JUNO : +{{amount}}.',
    );
  });

  it('names the SDR option and the software encoder explicitly', () => {
    expect(voice.streamSettings.forceSdrRestart).toContain('l’option Forcer le SDR');
    expect(voice.streamSettings.softwareH264Fallback).toContain('L’encodeur logiciel OpenH264 est utilisé');
  });

  it('uses the standard macOS version wording', () => {
    expect(voice.streamSettings.electronMacAudioNote).toContain('macOS 13 ou version ultérieure');
    expect(voice.streamSettings.systemAudioNote.unavailableMac).toContain('macOS 13 ou version ultérieure');
  });

  it('describes the Windows borderless capture permission in natural French word order', () => {
    expect(voice.screenPicker.borderless.deniedUser).toBe(
      'L’autorisation de partager sans la bordure de capture de Windows a été refusée. Le partage est bloqué.',
    );
  });
});
