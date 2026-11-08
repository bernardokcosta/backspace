import { describe, expect, it } from 'vitest';

interface VoiceControlCopy {
  streamSettings: { forceSdr: string; forceSdrRestart: string; forceSdrFailed: string };
  screenPicker: { borderless: { unsupported: string } };
}

const catalogs = import.meta.glob<VoiceControlCopy>('../locales/*/voice.json', { eager: true, import: 'default' });

describe('translated control references', () => {
  for (const [file, catalog] of Object.entries(catalogs)) {
    if (file.includes('/en/')) continue;
    it(`uses translated SDR instructions in ${file}`, () => {
      for (const value of [catalog.streamSettings.forceSdrRestart, catalog.streamSettings.forceSdrFailed, catalog.screenPicker.borderless.unsupported]) {
        expect(value).not.toContain('Force SDR');
      }
    });
  }

  it('uses a grammatical Korean setting reference instead of attaching 을 to 제', () => {
    expect(catalogs['../locales/ko/voice.json']!.streamSettings.forceSdrRestart).toBe('‘SDR 강제’ 설정을 변경하려면 공유를 중지한 뒤 다시 시작하세요.');
  });
});
