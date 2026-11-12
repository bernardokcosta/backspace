import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JunoView } from '@veyvox/shared/src/juno';
import { JunoRules } from './JunoRules';
import { JunoLocale } from './JunoLocale';
import { useJunoPreferences } from '../../stores/junoPreferences';
import appI18n from '../../i18n';

const game: Pick<JunoView, 'phase' | 'supportsReports' | 'memoryEnabled' | 'supportsBots'> = {
  phase: 'playing', supportsReports: true, memoryEnabled: true, supportsBots: true,
};
async function open(props: Parameters<typeof JunoRules>[0] = { game, supportsMemory: true }) {
  const view = render(<div className="juno-table"><div className="juno-header"><JunoRules {...props} /></div></div>);
  const trigger = view.container.querySelector('summary') as HTMLElement;
  await userEvent.click(trigger);
  return { ...view, trigger, guide: await screen.findByRole('region', { name: 'How to play' }) };
}
function geometry(guide: HTMLElement) {
  const scroller = guide.querySelector('.juno-guide-scroll') as HTMLElement;
  Object.defineProperties(scroller, { clientHeight: { configurable: true, value: 300 }, scrollHeight: { configurable: true, value: 2200 } });
  guide.querySelectorAll('h3').forEach((heading, index) => Object.defineProperty(heading, 'offsetTop', { configurable: true, value: 40 + index * 300 }));
  return scroller;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('illustrated Juno rules', () => {
  it('teaches the supplied Entorpecido only when the host supports it', async () => {
    const { guide, rerender } = await open({ game: { ...game, intoxicatedEnabled: true }, supportsIntoxicated: true });
    expect(guide.querySelector('img[src="/games/juno/cards/intoxicated.webp"]')).toBeInTheDocument();
    expect(guide).toHaveTextContent(/50%.*one turn|one turn.*50%/i);
    rerender(<div className="juno-table"><div className="juno-header"><JunoRules game={game} supportsIntoxicated={false} /></div></div>);
    expect(guide.querySelector('img[src="/games/juno/cards/intoxicated.webp"]')).toBeNull();
  });
  it('does not imply Entorpecido is in a frozen mixed-client round just because the host supports it', async () => {
    const { guide } = await open({ game: { ...game, intoxicatedEnabled: false }, supportsIntoxicated: true });
    expect(guide.querySelector('img[src="/games/juno/cards/intoxicated.webp"]')).toBeNull();
  });
  it('does not render or request teaching illustrations before help is opened', () => {
    const { container } = render(<JunoRules game={game} />);
    expect(container.querySelector('img')).toBeNull(); expect(screen.queryByRole('region')).toBeNull();
  });
  it('lazily illustrates all seven sections with original static cards and a complete XP table', async () => {
    const { guide } = await open();
    expect(within(guide).getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual([
      'Getting started', 'Your turn', 'Action cards', 'Call JUNO', 'Special cards', 'Results and XP', 'Around the table',
    ]);
    for (const path of ['sky-5.webp', 'sky-9.webp', 'coral-5.webp', 'sky-skip.webp', 'mint-reverse.webp', 'amber-draw2.webp', 'wild.webp', 'draw4.webp', 'memory.webp']) {
      expect(guide.querySelector(`img[src="/games/juno/cards/${path}"]`)).not.toBeNull();
    }
    expect(guide.querySelectorAll('button img')).toHaveLength(0);
    expect(within(guide).getByRole('table')).toHaveTextContent('120');
    for (const value of ['80', '40', '20']) expect(within(guide).getByRole('table')).toHaveTextContent(value);
    expect(guide).toHaveTextContent(/no stacking/i); expect(guide).toHaveTextContent(/clears the curse/i);
    expect(guide).toHaveTextContent(/two hours/i); expect(guide).toHaveTextContent(/remains practice/i);
  });
  it.each([true, false, undefined])('teaches only the host reporting rules when supportsReports is %s', async supportsReports => {
    const { guide } = await open({ game: { ...game, supportsReports } });
    expect(within(guide).queryByText(/another player.*10 seconds/i) !== null).toBe(supportsReports === true);
    expect(within(guide).queryByText(/otherwise you draw two/i) !== null).toBe(supportsReports !== true);
  });
  it('distinguishes reporting alternatives before the table capabilities are known', async () => {
    const { guide } = await open({ game: null });
    expect(guide).toHaveTextContent(/depends on the table/i);
    expect(guide).toHaveTextContent(/another player.*10 seconds/i); expect(guide).toHaveTextContent(/otherwise you draw two/i);
  });
  it.each(['lobby', 'playing', 'unsupported'] as const)('explains memory availability in %s', async state => {
    const { guide } = await open({ game: { ...game, phase: state === 'lobby' ? 'lobby' : 'playing', memoryEnabled: false }, supportsMemory: state !== 'unsupported' });
    expect(within(guide).queryByRole('heading', { name: 'Special cards', level: 3 }) !== null).toBe(state !== 'unsupported');
    expect(within(guide).queryByText(/not active in this round/i) !== null).toBe(state === 'playing');
  });
  it('closes on Escape or the close control and restores the original help trigger', async () => {
    const { trigger, guide } = await open();
    await userEvent.click(within(guide).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'How to play' })).toBeNull(); expect(trigger).toHaveFocus();
    await userEvent.click(trigger); await screen.findByRole('region', { name: 'How to play' });
    await userEvent.keyboard('{Escape}'); expect(screen.queryByRole('region')).toBeNull(); expect(trigger).toHaveFocus();
  });
  it('updates the open guide in the game locale without changing Backspace or media edition', async () => {
    const appLanguage = appI18n.language;
    const view = render(<JunoLocale><JunoRules game={game} /></JunoLocale>);
    await userEvent.click(view.container.querySelector('summary') as HTMLElement);
    const guide = await screen.findByRole('region', { name: 'How to play' });
    try {
      act(() => useJunoPreferences.getState().setLanguage('de'));
      expect(await screen.findByRole('heading', { name: 'Der Einstieg' })).toBeInTheDocument();
      expect(view.container.querySelector('.juno-rules-content')).toBe(guide);
      expect(guide.querySelector('img[src="/games/juno/cards/memory.webp"]')).not.toBeNull();
      expect(appI18n.language).toBe(appLanguage);
    } finally { view.unmount(); act(() => useJunoPreferences.getState().setLanguage('auto')); }
  });
  it('moves focus and scroll within the guide without navigating or accessing private cards', async () => {
    const input = { ...game }; Object.defineProperty(input, 'hand', { get() { throw new Error('Private hand accessed'); } });
    const scrollTo = vi.fn(); const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
    try {
      const before = window.location.href, { guide } = await open({ game: input });
      await userEvent.click(within(guide).getByRole('navigation', { name: 'Guide contents' }).querySelectorAll('button')[4]);
      expect(within(guide).getByRole('heading', { name: 'Special cards', level: 3 })).toHaveFocus();
      expect(scrollTo).toHaveBeenCalled(); expect(window.location.href).toBe(before);
      await act(async () => { expect(input.phase).toBe('playing'); });
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollTo', original);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
    }
  });
  it('marks exactly one current section while scrolling forward and back without stealing focus', async () => {
    const { guide } = await open(), nav = within(guide).getByRole('navigation'), scroller = geometry(guide);
    expect(nav.querySelector('[aria-current="location"]')).toHaveTextContent('Getting started');
    const focus = within(nav).getByRole('button', { name: 'Call JUNO' }); focus.focus();
    for (const [top, name] of [[400, 'Your turn'], [1250, 'Special cards'], [20, 'Getting started']] as const) {
      scroller.scrollTop = top; fireEvent.scroll(scroller);
      expect(nav.querySelectorAll('[aria-current="location"]')).toHaveLength(1);
      expect(nav.querySelector('[aria-current="location"]')).toHaveTextContent(name); expect(focus).toHaveFocus();
    }
  });
  it('marks the final section at the bottom even if its heading cannot reach the reading line, then resets on reopen', async () => {
    const { guide, trigger } = await open(), scroller = geometry(guide);
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 2000 });
    scroller.scrollTop = 1700; fireEvent.scroll(scroller);
    expect(guide.querySelector('[aria-current="location"]')).toHaveTextContent('Around the table');
    await userEvent.click(within(guide).getByRole('button', { name: 'Close' })); await userEvent.click(trigger);
    expect((await screen.findByRole('region', { name: 'How to play' })).querySelector('[aria-current="location"]')).toHaveTextContent('Getting started');
  });
  it('keeps the geometric marker when a contents jump is clamped at the current bottom and emits no scroll event', async () => {
    const { guide } = await open(), scroller = geometry(guide);
    Object.defineProperties(scroller, { scrollHeight: { configurable: true, value: 2000 }, scrollTo: { configurable: true, value: vi.fn() } });
    const score = within(guide).getByRole('heading', { name: 'Results and XP', level: 3 });
    Object.defineProperty(score, 'offsetTop', { configurable: true, value: 1750 });
    scroller.scrollTop = 1700; fireEvent.scroll(scroller);
    expect(guide.querySelector('[aria-current="location"]')).toHaveTextContent('Around the table');
    await userEvent.click(within(guide).getByRole('navigation').querySelectorAll('button')[5]);
    expect(scroller.scrollTop).toBe(1700); expect(score).toHaveFocus();
    expect(guide.querySelector('[aria-current="location"]')).toHaveTextContent('Around the table');
  });
  it('recalculates the current section after layout changes or removing an unavailable category', async () => {
    const { guide, rerender } = await open(), scroller = geometry(guide);
    scroller.scrollTop = 1250; fireEvent.scroll(scroller);
    expect(guide.querySelector('[aria-current="location"]')).toHaveTextContent('Special cards');
    Object.defineProperty(within(guide).getByRole('heading', { name: 'Special cards', level: 3 }), 'offsetTop', { configurable: true, value: 1400 });
    fireEvent(window, new Event('resize'));
    expect(guide.querySelector('[aria-current="location"]')).toHaveTextContent('Call JUNO');
    rerender(<div className="juno-table"><div className="juno-header"><JunoRules game={{ ...game, memoryEnabled: false }} supportsMemory={false} /></div></div>);
    expect(within(guide).queryByRole('heading', { name: 'Special cards', level: 3 })).toBeNull();
    expect(guide.querySelectorAll('[aria-current="location"]')).toHaveLength(1);
    expect(guide.querySelector('[aria-current="location"]')).toHaveTextContent('Call JUNO');
  });
  it('observes the local layout and disconnects resize observation when the guide unmounts', async () => {
    let notify!: () => void;
    const observe = vi.fn(), disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notify = callback; }
      observe = observe; disconnect = disconnect;
    });
    const { guide, unmount } = await open(), scroller = geometry(guide);
    expect(observe).toHaveBeenCalledWith(scroller); expect(observe).toHaveBeenCalledWith(guide.querySelector('.juno-guide-layout'));
    scroller.scrollTop = 1250; act(notify);
    expect(guide.querySelector('[aria-current="location"]')).toHaveTextContent('Special cards');
    unmount(); expect(disconnect).toHaveBeenCalledOnce();
  });
});
