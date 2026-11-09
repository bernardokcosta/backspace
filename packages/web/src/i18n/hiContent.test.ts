import { describe, expect, it } from 'vitest';
import chat from '../locales/hi/chat.json';
import common from '../locales/hi/common.json';
import dm from '../locales/hi/dm.json';
import spaces from '../locales/hi/spaces.json';
import voice from '../locales/hi/voice.json';
import federation from '../locales/hi/federation.json';

describe('Hindi contextual content', () => {
  it('accepts relative times without treating them as calendar dates', () => {
    expect(federation.connections.row.connectedAgo).toBe('{{time}} कनेक्ट हुआ');
    expect(federation.connections.row.disconnectedAgo).toBe('{{time}} डिस्कनेक्ट हुआ');
    expect(federation.connections.row.lastConnectedAgo).toBe('अंतिम कनेक्ट {{time}}');
    expect(federation.admin.approvals.requested).toBe('{{time}} अनुरोधित');
  });

  it('describes per-listener mute without claiming a server mute', () => {
    expect(voice.participantMenu.muteUser).toBe('मेरे लिए म्यूट करें');
    expect(spaces.mobile.muteUser).toBe(voice.participantMenu.muteUser);
  });

  it('scopes Space moderation to the Space', () => {
    expect(voice.moderation.spaceMute).toBe('स्पेस में म्यूट करें');
    expect(voice.moderation.spaceDeafen).toBe('स्पेस में बहरा करें');
  });

  it('uses a neutral reaction label when the viewer is part of a mixed list', () => {
    expect(chat.message.reactions.byMany).toBe('प्रतिक्रियाएं: {{names}}');
  });

  it('keeps Veyvox and Juno automatic labels distinct', () => {
    expect(common.language.automatic).toBe('स्वचालित (सिस्टम)');
    expect(voice.juno.settings.automatic).toBe('स्वचालित (Veyvox)');
    expect(voice.juno.settings.automaticDubbing).toBe(voice.juno.settings.automatic);
  });

  it('names a group direct message without addressing it as a person', () => {
    expect(dm.names.groupFallback).toBe('समूह DM');
  });

  it('keeps the rare Alzheimer card rule complete', () => {
    expect(voice.juno.memory.rules).toContain('अल्ज़ाइमर');
    expect(voice.juno.faces.memory).toBe('अल्ज़ाइमर');
  });

  it('uses a translated minute unit for AFK', () => {
    expect(spaces.settings.afk.minutes).toBe('मिनट');
  });
});
