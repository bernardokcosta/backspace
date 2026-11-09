import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n, { setLanguage } from '../../i18n';
import { useJunoStore } from '../../stores/junoStore';
import { useUIStore } from '../../stores/uiStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { DEFAULT_JUNO_PREFERENCES, useJunoPreferences } from '../../stores/junoPreferences';
import { useJunoMusicState } from '../../audio/junoMusic';
import { JunoTable } from './JunoTable';
import { junoGame } from './junoTestFixtures';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
const command = vi.fn(async () => {});
beforeEach(async () => {
  await setLanguage('en'); localStorage.clear(); useJunoPreferences.setState(DEFAULT_JUNO_PREFERENCES);
  useJunoStore.getState().reset(); useJunoStore.getState().bind({ accountId: 'a', selfId: 'a', origin: '', channelId: 'voice' }, true);
  useJunoStore.setState({ open: true, snapshot: { revision: 1, game: junoGame('playing') }, command }); command.mockClear();
  useUIStore.setState({ isMobile: false, voiceFullscreen: true }); useVoiceStore.setState({ soundEffectVolume: 75, outputVolume: 80 });
  useJunoMusicState.setState({ status: 'idle', retry: null });
});
afterEach(async () => { await setLanguage('en'); useJunoPreferences.setState(DEFAULT_JUNO_PREFERENCES); });
describe('personal Juno settings modal', () => {
  it.each(['lobby', 'playing', 'finished'] as const)('offers the gear in %s without a game command', async phase => {
    useJunoStore.setState({ snapshot: { revision: 1, game: junoGame(phase) } }); render(<JunoTable />);
    await userEvent.click(screen.getByRole('button', { name: 'Juno settings' })); expect(screen.getByRole('dialog', { name: 'Juno settings' })).toBeInTheDocument(); expect(command).not.toHaveBeenCalled();
  });
  it('contains keyboard focus and returns to the gear without closing the call', async () => {
    render(<JunoTable />); const gear = screen.getByRole('button', { name: 'Juno settings' }); await userEvent.click(gear);
    expect(screen.getByRole('combobox', { name: 'Game language' })).toHaveFocus();
    const close = screen.getByRole('button', { name: 'Close' }); close.focus(); await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.getByRole('slider', { name: 'Background music' })).toHaveFocus(); await userEvent.keyboard('{Tab}'); expect(close).toHaveFocus();
    await userEvent.keyboard('{Escape}'); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(gear).toHaveFocus();
    expect(useUIStore.getState().voiceFullscreen).toBe(true); expect(useJunoStore.getState().open).toBe(true); expect(command).not.toHaveBeenCalled();
  });
  it('offers Automatic/twenty-five languages, only real pt-BR media and two default 100% controls', async () => {
    render(<JunoTable />); await userEvent.click(screen.getByRole('button', { name: 'Juno settings' }));
    expect(screen.getByRole('dialog').querySelector('p')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Game language' }).querySelectorAll('option')).toHaveLength(26);
    const dubbing = screen.getByRole('combobox', { name: 'Dubbing and card text' }); expect(dubbing.querySelectorAll('option')).toHaveLength(2); expect(dubbing).toHaveValue('auto');
    for (const select of screen.getAllByRole('combobox')) expect(select.querySelector('option[value="auto"]')).toHaveTextContent('Automatic (Veyvox)');
    expect(screen.getByRole('slider', { name: 'Sound effects' })).toHaveValue('100'); expect(screen.getByRole('slider', { name: 'Background music' })).toHaveValue('100');
    fireEvent.change(screen.getByRole('slider', { name: 'Background music' }), { target: { value: '35' } });
    expect(useJunoPreferences.getState().musicVolume).toBe(35); expect(screen.getByText('35%')).toBeInTheDocument();
    expect(useVoiceStore.getState()).toMatchObject({ soundEffectVolume: 75, outputVolume: 80 }); expect(command).not.toHaveBeenCalled();
  });
  it('keeps the modal and field focused while changing only the game language', async () => {
    render(<JunoTable />); await userEvent.click(screen.getByRole('button', { name: 'Juno settings' })); const picker = screen.getByRole('combobox', { name: 'Game language' });
    await userEvent.selectOptions(picker, 'pt'); await screen.findByRole('dialog', { name: 'Configurações do Juno' });
    expect(screen.getByRole('combobox', { name: 'Idioma do jogo' })).toBe(picker); expect(picker).toHaveFocus(); expect(i18n.language).toBe('en');
    await userEvent.selectOptions(picker, 'auto'); await screen.findByRole('dialog', { name: 'Juno settings' }); expect(command).not.toHaveBeenCalled();
  });
  it('exposes a gesture retry when autoplay is blocked and closes on target change', async () => {
    const retry = vi.fn(); useJunoMusicState.setState({ status: 'blocked', retry }); render(<JunoTable />); await userEvent.click(screen.getByRole('button', { name: 'Juno settings' }));
    await userEvent.click(screen.getByRole('button', { name: 'Play music' })); expect(retry).toHaveBeenCalledOnce();
    act(() => useJunoStore.getState().bind({ accountId: 'other', selfId: 'other', channelId: 'voice', origin: '' }, true));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
