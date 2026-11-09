import { createRef } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTranslation } from 'react-i18next';
import userEvent from '@testing-library/user-event';
import type { JunoView } from '@veyvox/shared/src/juno';
import i18n, { setLanguage } from './index';
import { useFormatters } from './formatters';
import { DEFAULT_JUNO_PREFERENCES, useJunoPreferences } from '../stores/junoPreferences';
import { useJunoStore } from '../stores/junoStore';
import { JunoLocale } from '../components/games/JunoLocale';
import { JunoTable } from '../components/games/JunoTable';
import { JunoTile } from '../components/games/JunoTile';
import { junoSeats } from '../components/games/junoSeats';
import { MentionTextarea } from '../components/chat/MentionTextarea';
import { composerMentions } from '../components/chat/composerMentions';

const junoStyles = readFileSync(path.resolve(import.meta.dirname, '../components/games/juno.css'), 'utf8');

vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));

function GameProbe({ name }: { name: string }) {
  const { i18n: instance } = useTranslation('voice');
  const f = useFormatters();
  return (
    <div data-testid={name} data-language={instance.language}>
      {f.formatNumber(1234)}
    </div>
  );
}

function game(): JunoView {
  return {
    id: 'game', phase: 'playing', hostId: 'a',
    players: [
      { userId: 'a', name: 'Ada', cardCount: 2, announced: false },
      { userId: 'b', name: 'Bo', cardCount: 7, announced: false },
    ],
    hand: [], topCard: { id: 'top', face: '3', color: 'coral' }, color: 'coral',
    direction: 1, currentPlayerId: 'a', drawnCardId: null, remainingMs: 40_000,
    winnerId: null, result: null, lastMove: null,
  };
}

function seatOrder(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll('.juno-seat')].map((s) => s.getAttribute('data-seat'));
}

beforeEach(async () => {
  localStorage.clear();
  useJunoPreferences.setState(DEFAULT_JUNO_PREFERENCES);
  useJunoStore.getState().reset();
  await setLanguage('en');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await setLanguage('en');
  useJunoPreferences.setState(DEFAULT_JUNO_PREFERENCES);
  useJunoStore.getState().reset();
});

describe('scoped game language and direction', () => {
  it('keeps the app language while the game uses its own script and direction', async () => {
    render(
      <>
        <GameProbe name="app" />
        <JunoLocale>
          <GameProbe name="game" />
        </JunoLocale>
      </>,
    );
    act(() => useJunoPreferences.getState().setLanguage('ar'));
    await waitFor(() => expect(screen.getByTestId('game')).toHaveAttribute('data-language', 'ar'));
    expect(i18n.language).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('renders table and tile roots with the game lang and dir', async () => {
    act(() => useJunoPreferences.getState().setLanguage('ar'));
    const { container } = render(<JunoTable />);
    const table = container.querySelector('.juno-table');
    expect(table).toHaveAttribute('lang', 'ar');
    expect(table).toHaveAttribute('dir', 'rtl');
    const tile = render(<JunoTile />);
    expect(tile.container.querySelector('.juno-tile')).toHaveAttribute('lang', 'ar');
    expect(tile.container.querySelector('.juno-tile')).toHaveAttribute('dir', 'rtl');
  });

  it('renders an English game inside an Arabic app without changing the document', async () => {
    await act(async () => setLanguage('ar'));
    act(() => useJunoPreferences.getState().setLanguage('en'));
    const { container } = render(<JunoTable />);
    const table = container.querySelector('.juno-table');
    expect(table).toHaveAttribute('lang', 'en');
    expect(table).toHaveAttribute('dir', 'ltr');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('renders the portalled settings dialog with the game lang and dir', async () => {
    useJunoStore.setState({
      target: { accountId: 'a', selfId: 'a', origin: '', channelId: 'voice' },
      connected: true, snapshot: { revision: 1, game: game() }, observedAt: Date.now(), open: true,
    } as never);
    act(() => useJunoPreferences.getState().setLanguage('ar'));
    render(<JunoTable />);
    await userEvent.click(screen.getByRole('button', { name: /juno settings/i }));
    const dialog = document.querySelector('.juno-settings');
    expect(dialog).toHaveAttribute('lang', 'ar');
    expect(dialog).toHaveAttribute('dir', 'rtl');
  });

  it('follows later app changes only in Automatic mode with game number formatting', async () => {
    render(
      <JunoLocale>
        <GameProbe name="game" />
      </JunoLocale>,
    );
    await act(async () => setLanguage('ar'));
    await waitFor(() => expect(screen.getByTestId('game')).toHaveAttribute('data-language', 'ar'));
    expect(screen.getByTestId('game')).toHaveTextContent(new Intl.NumberFormat('ar').format(1234));
    act(() => useJunoPreferences.getState().setLanguage('de'));
    await waitFor(() => expect(screen.getByTestId('game')).toHaveAttribute('data-language', 'de'));
    expect(screen.getByTestId('game')).toHaveTextContent(new Intl.NumberFormat('de').format(1234));
    act(() => useJunoPreferences.getState().setLanguage('auto'));
    await waitFor(() => expect(screen.getByTestId('game')).toHaveAttribute('data-language', 'ar'));
  });

  it('keeps physical seat identity and DOM order identical across game languages', async () => {
    const players = [
      { userId: 'a', name: 'Ada' },
      { userId: 'b', name: 'Bo' },
      { userId: 'c', name: 'Cy' },
      { userId: 'd', name: 'De' },
    ];
    expect(junoSeats(players, 'c')).toEqual(junoSeats(players, 'c'));

    useJunoStore.setState({
      target: { accountId: 'a', selfId: 'a', origin: '', channelId: 'voice' },
      connected: true,
      snapshot: {
        revision: 1,
        game: { ...game(), players: players.map((p) => ({ ...p, cardCount: 7, announced: false })) },
      },
      observedAt: Date.now(), open: true,
    } as never);
    act(() => useJunoPreferences.getState().setLanguage('en'));
    const enView = render(<JunoTable />);
    const enOrder = seatOrder(enView.container);
    enView.unmount();

    act(() => useJunoPreferences.getState().setLanguage('ar'));
    const arView = render(<JunoTable />);
    expect(seatOrder(arView.container)).toEqual(enOrder);
    // The arena itself carries no direction override; geometry is pinned by CSS.
    expect(arView.container.querySelector('.juno-arena')).not.toHaveAttribute('dir', 'rtl');
  });
});

describe('bidi isolation for user content', () => {
  it('keeps header geometry LTR and Arabic guide prose RTL with the actual stylesheet', () => {
    const style = document.createElement('style');
    style.textContent = junoStyles;
    document.head.append(style);
    try {
      const { container } = render(
        <section className="juno-table" lang="ar" dir="rtl">
          <header className="juno-header">
            <div className="juno-header-brand" />
            <div className="juno-header-actions">
              <div className="juno-rules-content">مرحبا</div>
            </div>
          </header>
        </section>,
      );
      expect(getComputedStyle(container.querySelector('.juno-header')!).direction).toBe('ltr');
      expect(getComputedStyle(container.querySelector('.juno-rules-content')!).direction).toBe('rtl');
    } finally {
      style.remove();
    }
  });

  it('allows long translated card captions to wrap without shrinking copy', () => {
    const style = document.createElement('style');
    style.textContent = junoStyles;
    document.head.append(style);
    try {
      const { container } = render(
        <div className="juno-guide-matches"><figure><figcaption>Універсальна · виберіть колір</figcaption></figure></div>,
      );
      const caption = getComputedStyle(container.querySelector('figcaption')!);
      expect(caption.overflowWrap).toBe('anywhere');
      expect(caption.fontSize).toBe('12px');
    } finally {
      style.remove();
    }
  });

  it('marks the composer textarea and its mirror with automatic direction', () => {
    const textareaRef = createRef<HTMLTextAreaElement>();
    const mentionAnchorRef = createRef<HTMLSpanElement>();
    const model = composerMentions('hello', () => null);
    const { container } = render(
      <MentionTextarea model={model} textareaRef={textareaRef} mentionAnchorRef={mentionAnchorRef} onChange={vi.fn()} />,
    );
    expect(container.querySelector('textarea')).toHaveAttribute('dir', 'auto');
    expect(container.querySelector('[aria-hidden="true"] > div')).toHaveAttribute('dir', 'auto');
  });

  it('matches the mirror bidi treatment to the native textarea (per-paragraph)', () => {
    const textareaRef = createRef<HTMLTextAreaElement>();
    const mentionAnchorRef = createRef<HTMLSpanElement>();
    const model = composerMentions('hello', () => null);
    const { container } = render(
      <MentionTextarea model={model} textareaRef={textareaRef} mentionAnchorRef={mentionAnchorRef} onChange={vi.fn()} />,
    );
    // The native textarea resolves bidi per paragraph; the mirror must use the
    // same treatment or mixed LTR/RTL lines paint at different x offsets.
    expect(getComputedStyle(container.querySelector('[aria-hidden="true"] > div')!).unicodeBidi).toBe('plaintext');
  });

  it('keeps arena prose on the game direction contract (no local dir overrides)', async () => {
    useJunoStore.setState({
      target: { accountId: 'a', selfId: 'a', origin: '', channelId: 'voice' },
      connected: true,
      snapshot: {
        revision: 1,
        game: { ...game(), players: game().players.map((p) => ({ ...p })) },
      },
      observedAt: Date.now(), open: true,
    } as never);
    act(() => useJunoPreferences.getState().setLanguage('ar'));
    const { container } = render(<JunoTable />);
    // CSS pins .juno-arena to LTR geometry and re-applies the game language
    // direction on prose roots via :lang(ar); the DOM contract is that neither
    // the arena nor its prose roots override dir themselves (jsdom runs with
    // css:false, so settled computed geometry stays a browser L3 check).
    const arena = container.querySelector('.juno-arena')!;
    expect(arena.hasAttribute('dir')).toBe(false);
    for (const prose of arena.querySelectorAll('.juno-memory-message, .juno-player-controls, .juno-table-info, .juno-called')) {
      expect(prose.hasAttribute('dir')).toBe(false);
    }
    // The game root still carries the language direction the CSS keys off.
    expect(container.querySelector('.juno-table')).toHaveAttribute('dir', 'rtl');
  });
});
