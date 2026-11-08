import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTranslation } from 'react-i18next';
import i18n, { setLanguage } from '../../i18n';
import { useFormatters } from '../../i18n/formatters';
import { describeError } from '../../i18n/errors';
import { HttpError } from '../../api/client';
import { DEFAULT_JUNO_PREFERENCES, useJunoPreferences } from '../../stores/junoPreferences';
import { JunoLocale } from './JunoLocale';
function Probe({ name }: { name: string }) {
  const { t, i18n: instance } = useTranslation('voice'); const f = useFormatters();
  return <div data-testid={name} data-language={instance.language}>{t('juno.memory.title')}|{f.formatNumber(1234)}|{describeError(new HttpError(400, 'no', undefined, 'juno_invalid_move'), instance)}</div>;
}
beforeEach(async () => { localStorage.clear(); useJunoPreferences.setState(DEFAULT_JUNO_PREFERENCES); await setLanguage('en'); });
afterEach(async () => { vi.restoreAllMocks(); await setLanguage('en'); useJunoPreferences.setState(DEFAULT_JUNO_PREFERENCES); });
describe('Juno-only locale boundary', () => {
  it('changes game copy, formatting and errors without changing app/HTML/storage', async () => {
    render(<><Probe name="app" /><JunoLocale><Probe name="game" /></JunoLocale></>);
    act(() => useJunoPreferences.getState().setLanguage('de'));
    await waitFor(() => expect(screen.getByTestId('game')).toHaveTextContent('Nebliges Gedächtnis|1.234|'));
    expect(screen.getByTestId('app')).toHaveTextContent('Nebulous memory|1,234|');
    expect(i18n.language).toBe('en'); expect(document.documentElement.lang).toBe('en'); expect(localStorage.getItem('backspace-language')).toBe('en');
    expect(screen.getByTestId('game').textContent).not.toContain('That move');
  });
  it('follows later app changes only in Automatic and does not remount children', async () => {
    render(<JunoLocale><input aria-label="stable" defaultValue="kept" /><Probe name="game" /></JunoLocale>);
    const input = screen.getByRole('textbox'); input.focus();
    await act(async () => setLanguage('pt')); await waitFor(() => expect(screen.getByTestId('game')).toHaveTextContent('Memória nebulosa'));
    act(() => useJunoPreferences.getState().setLanguage('de')); await waitFor(() => expect(screen.getByTestId('game')).toHaveTextContent('Nebliges Gedächtnis'));
    await act(async () => setLanguage('en')); expect(screen.getByTestId('game')).toHaveTextContent('Nebliges Gedächtnis');
    act(() => useJunoPreferences.getState().setLanguage('auto')); await waitFor(() => expect(screen.getByTestId('game')).toHaveTextContent('Nebulous memory'));
    expect(screen.getByRole('textbox')).toBe(input); expect(input).toHaveFocus(); expect(input).toHaveValue('kept');
  });
  it('retains selected script and number formatting when every game label falls back', async () => {
    render(<JunoLocale><Probe name="game" /></JunoLocale>);
    await act(async () => setLanguage('ar'));
    await waitFor(() => expect(screen.getByTestId('game')).toHaveAttribute('data-language', 'ar'));
    expect(screen.getByTestId('game')).toHaveTextContent(new Intl.NumberFormat('ar').format(1234));
    expect(document.documentElement.lang).toBe('ar');
  });

  it('ignores obsolete lazy completions after a newer game choice or unmount', async () => {
    const load = i18n.loadLanguages.bind(i18n);
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(i18n, 'loadLanguages').mockImplementation(language => language === 'de' ? delayed : load(language));
    const clones = vi.spyOn(i18n, 'cloneInstance');
    const view = render(<JunoLocale><Probe name="game" /></JunoLocale>);
    const scoped = clones.mock.results[0]!.value as typeof i18n;
    const change = vi.spyOn(scoped, 'changeLanguage');
    act(() => useJunoPreferences.getState().setLanguage('de'));
    act(() => useJunoPreferences.getState().setLanguage('pt'));
    await waitFor(() => expect(screen.getByTestId('game')).toHaveAttribute('data-language', 'pt'));
    view.unmount();
    await act(async () => { release(); await delayed; });
    expect(change).not.toHaveBeenCalledWith('de');
    expect(i18n.language).toBe('en');
    expect(localStorage.getItem('backspace-language')).toBe('en');
  });

  it('serializes an already-started scoped change before committing a newer one', async () => {
    const clones = vi.spyOn(i18n, 'cloneInstance');
    render(<JunoLocale><Probe name="game" /></JunoLocale>);
    const scoped = clones.mock.results[0]!.value as typeof i18n;
    const actual = scoped.changeLanguage.bind(scoped);
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    const change = vi.spyOn(scoped, 'changeLanguage').mockImplementation(language => language === 'de' ? delayed.then(() => actual(language)) : actual(language));
    act(() => useJunoPreferences.getState().setLanguage('de'));
    await waitFor(() => expect(change).toHaveBeenCalledWith('de'));
    await act(async () => { useJunoPreferences.getState().setLanguage('pt'); await i18n.loadLanguages('pt'); });
    await act(async () => { release(); await delayed; });
    await waitFor(() => expect(screen.getByTestId('game')).toHaveAttribute('data-language', 'pt'));
  });
});
