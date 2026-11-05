import { describe, expect, it } from 'vitest';
import en from '../../locales/en/voice.json';
import pt from '../../locales/pt/voice.json';
import de from '../../locales/de/voice.json';
import ru from '../../locales/ru/voice.json';
import zh from '../../locales/zh/voice.json';
describe('Juno progression copy', () => {
  it.each([en, pt, de, ru, zh])('includes real ranking and credit states in every catalog', catalog => {
    for (const key of ['rankingTitle', 'spaceRanking', 'xpEarned', 'totalXp', 'noRank', 'emptyRanking',
      'creditPending', 'abandoned', 'unranked', 'rankingUnavailable', 'backToGame', 'roundResults', 'victory']) {
      expect((catalog.juno as Record<string, unknown>)[key]).toEqual(expect.any(String));
    }
  });
});
