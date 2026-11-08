import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JunoSettings } from './JunoSettings';
import { JunoLocale } from './JunoLocale';
import { supportedLanguages } from '../../i18n/languages';

vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));

vi.mock('../../i18n', async original => {
  const module = await original<typeof import('../../i18n')>();
  return { ...module, availableLanguages: module.supportedLanguages };
});

describe('Juno registry-driven language options', () => {
  it('supports the complete registry when test release eligibility includes all 25', () => {
    render(<JunoLocale><JunoSettings onClose={() => undefined} trigger={{ current: null }} /></JunoLocale>);
    const game = screen.getByRole('combobox', { name: 'Game language' });
    expect(game.querySelectorAll('option')).toHaveLength(26);
    for (const language of supportedLanguages) expect(game.querySelector(`option[value="${language.code}"]`)).toHaveTextContent(language.nativeName);
    const dubbing = screen.getByRole('combobox', { name: 'Dubbing and card text' });
    expect(dubbing.querySelectorAll('option')).toHaveLength(2);
    expect(dubbing.querySelector('option[value="pt-BR"]')).toHaveTextContent('Português (Brasil)');
  });
});
