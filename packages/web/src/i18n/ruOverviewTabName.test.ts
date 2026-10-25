import { describe, it, expect } from 'vitest';
import ruSpaces from '../locales/ru/spaces.json';
import ruDm from '../locales/ru/dm.json';
import ruCommon from '../locales/ru/common.json';
import enSpaces from '../locales/en/spaces.json';
import enDm from '../locales/en/dm.json';

/** Retain consistent Russian Overview labels after retiring the Explore page. */

/** Any case of обзор: обзоре, обзором, обзора… */
const OVERVIEW_WORD = /обзор/iu;

describe('the Russian names for retained Overview tabs', () => {
  it('is never reused for an Overview tab', () => {
    // The two Overview tabs: one in space settings, one in group DM
    // settings. Their English is the check that these keys are still the
    // tab labels and not something else that drifted into the same place.
    const tabs: [string, string, string][] = [
      ['spaces:settings.nav.tabs.overview', enSpaces.settings.nav.tabs.overview, ruSpaces.settings.nav.tabs.overview],
      ['dm:groupSettings.overview', enDm.groupSettings.overview, ruDm.groupSettings.overview],
    ];
    for (const [key, english, russian] of tabs) {
      expect(english, key).toBe('Overview');
      expect(OVERVIEW_WORD.test(russian), `${key} -> "${russian}"`).toBe(false);
    }
  });

  it('leaves the two Overview tabs with one name between them', () => {
    // Same concept in two places, so one name: a rename that reaches only
    // one of the two strips is the same defect in a smaller form.
    expect(ruDm.groupSettings.overview).toBe(ruSpaces.settings.nav.tabs.overview);
  });

  it('does not collide with a sibling tab in either strip', () => {
    const tabLabel = ruSpaces.settings.nav.tabs.overview;
    const spaceSiblings = [
      ruSpaces.settings.nav.tabs.roles,
      ruSpaces.settings.nav.tabs.bans,
      ruSpaces.permissions.title,
      ruCommon.labels.members,
    ];
    for (const sibling of spaceSiblings) {
      expect(sibling).not.toBe(tabLabel);
    }
    // The group DM strip is «Основное» and «Участники» under a «Общие»
    // section heading.
    expect(ruDm.groupSettings.overview).not.toBe(ruCommon.labels.members);
    expect(ruDm.groupSettings.overview).not.toBe(ruDm.groupSettings.general);
  });
});
