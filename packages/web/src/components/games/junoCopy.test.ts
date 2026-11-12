import { describe, expect, it } from 'vitest';
import en from '../../locales/en/voice.json';
import pt from '../../locales/pt/voice.json';
import de from '../../locales/de/voice.json';
import ru from '../../locales/ru/voice.json';
import zh from '../../locales/zh/voice.json';
describe('Juno progression copy', () => {
  it('translates the complete single-turn Entorpecido contract in all 25 catalogs', () => {
    const catalogs = import.meta.glob<{ juno: { intoxicated?: Record<string, string> } }>('../../locales/*/voice.json', { eager: true, import: 'default' });
    expect(Object.keys(catalogs)).toHaveLength(25);
    for (const [path, catalog] of Object.entries(catalogs)) {
      const copy = catalog.juno.intoxicated;
      expect(copy, path).toBeDefined();
      for (const key of ['title', 'instruction', 'affected', 'miss', 'colorChanged', 'rules']) expect(copy?.[key], `${path}:${key}`).toEqual(expect.any(String));
      expect(copy?.instruction).toMatch(/(?:50\s*%|%\s*50)/); expect(copy?.rules).toMatch(/(?:50\s*%|%\s*50)/);
      expect(copy?.affected).toContain('{{name}}'); expect(copy?.miss).toContain('{{amount}}'); expect(copy?.colorChanged).toContain('{{name}}');
    }
  });
  it.each([en, pt, de, ru, zh])('includes real ranking and credit states in every catalog', catalog => {
    for (const key of ['rankingTitle', 'spaceRanking', 'xpEarned', 'totalXp', 'noRank', 'emptyRanking',
      'creditPending', 'abandoned', 'unranked', 'rankingUnavailable', 'backToGame', 'roundResults', 'victory']) {
      expect((catalog.juno as Record<string, unknown>)[key]).toEqual(expect.any(String));
    }
  });
});
