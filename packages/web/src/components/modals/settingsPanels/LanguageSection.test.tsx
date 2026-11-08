import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { initI18n, getLanguagePreference } from '../../../i18n';
import { LanguageSection } from './LanguageSection';

beforeEach(async () => {
  localStorage.clear();
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en']);
  await initI18n();
});
afterEach(() => { vi.restoreAllMocks(); });

describe('app language preference selector', () => {
  it('selects and persists mode even when the effective language stays English', async () => {
    render(<LanguageSection />);
    const select = screen.getByRole('combobox');
    expect(select).toHaveValue('auto');
    expect(screen.getByRole('option', { name: 'Automatic (system)' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Português (Brasil)' })).toHaveValue('pt');
    fireEvent.change(select, { target: { value: 'en' } });
    await waitFor(() => expect(getLanguagePreference()).toBe('en'));
    expect(select).toHaveValue('en');
    fireEvent.change(select, { target: { value: 'auto' } });
    await waitFor(() => expect(select).toHaveValue('auto'));
    expect(localStorage.getItem('backspace-language')).toBe('auto');
  });

  it('keeps the dev-only preview visible without saving it', async () => {
    await act(async () => initI18n({ previewLanguage: 'fr' }));
    render(<LanguageSection />);
    expect(screen.getByRole('option', { name: 'Français' })).toBeInTheDocument();
    expect(localStorage.getItem('backspace-language')).toBeNull();
  });
  it('leaves a preview unsaved when the user selects a real preference', async () => {
    await initI18n({ previewLanguage: 'fr' });
    render(<LanguageSection />);
    const picker = screen.getByRole('combobox');
    expect(picker).toHaveValue('auto');
    expect(screen.getByRole('option', { name: 'Français' })).toBeInTheDocument();
    expect(localStorage.getItem('backspace-language')).toBeNull();
    fireEvent.change(picker, { target: { value: 'en' } });
    await waitFor(() => expect(picker).toHaveValue('en'));
    expect(getLanguagePreference()).toBe('en');
  });
});
