import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JunoEffects } from './JunoEffects';

afterEach(() => vi.useRealTimers());
describe('confirmed Juno feedback', () => {
  it('shows confirmed wrong-card feedback only to its owner, never as a public discard, without replay', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<JunoEffects move={null} position="bottom" name="Ada" viewerId="a" />);
    const move = { id: 'intoxicated-miss', type: 'intoxicated_miss' as const, userId: 'a', amount: 2,
      misplayedCard: { id: 'private-other', face: '2' as const, color: 'sky' as const } };
    rerender(<JunoEffects move={move} position="bottom" name="Ada" viewerId="a" />);
    expect(container.querySelector('.juno-effect-intoxicated-miss')).toHaveTextContent(/Ada.*2/);
    expect(container.querySelector('.juno-intoxicated-wrong-card img')).toHaveAttribute('src', '/games/juno/cards/sky-2.webp');
    expect(container.querySelector('.juno-effect-card')).toBeNull();
    rerender(<JunoEffects move={{ ...move, id: 'opponent-view' }} position="top" name="Ada" viewerId="b" />);
    expect(container.querySelector('.juno-intoxicated-wrong-card')).toBeNull();
    act(() => vi.advanceTimersByTime(1400));
    rerender(<JunoEffects move={{ ...move, id: 'opponent-view' }} position="top" name="Ada" viewerId="b" />);
    expect(container.querySelector('.juno-effect-intoxicated-miss')).toBeNull();
  });
  it('shows a confirmed blind miss without revealing or flying the attempted card', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<JunoEffects move={null} position="bottom" name="Ada" />);
    const move = { id: 'miss', type: 'memory_miss' as const, userId: 'a', amount: 2 };
    rerender(<JunoEffects move={move} position="bottom" name="Ada" />);
    expect(container.querySelector('.juno-effect-memory-miss')).toHaveTextContent('Ada made an invalid blind attempt and drew 2.');
    expect(container.querySelector('.juno-effect-card,.juno-effect-draw,img')).toBeNull();
    act(() => vi.advanceTimersByTime(1400));
    rerender(<JunoEffects move={{ ...move }} position="bottom" name="Ada" />);
    expect(container.querySelector('.juno-effect-memory-miss')).toBeNull();
  });
  it('does not replay on mount or polling, anchors confirmed calls and always expires', () => {
    vi.useFakeTimers();
    const old = { id: 'old', type: 'announce' as const, userId: 'a', announced: true };
    const { container, rerender, unmount } = render(<JunoEffects move={old} position="left" name="Ada" />);
    expect(container.querySelector('.juno-effect-announce')).toBeNull();
    const next = { ...old, id: 'next' };
    rerender(<JunoEffects move={next} position="right" name="Bo" />);
    expect(container.querySelector('.juno-effect-announce')).toHaveAttribute('data-from', 'right');
    act(() => vi.advanceTimersByTime(700));
    rerender(<JunoEffects move={{ ...next }} position="right" name="Bo" />);
    act(() => vi.advanceTimersByTime(701));
    expect(container.querySelector('.juno-effect-announce')).toBeNull();
    rerender(<JunoEffects move={{ ...next }} position="right" name="Bo" />);
    expect(container.querySelector('.juno-effect-announce')).toBeNull();
    unmount(); expect(vi.getTimerCount()).toBe(0);
  });
  it('renders only the public played card and visible special-card impact', () => {
    const { container, rerender } = render(<JunoEffects move={null} position="bottom" name="Ada" />);
    rerender(<JunoEffects move={{ id: 'play', type: 'play', userId: 'a', card: { id: 'public', face: 'draw4', color: null } }} position="bottom" name="Ada" />);
    expect(container.querySelector('.juno-effect-card img')).toHaveAttribute('src', '/games/juno/cards/draw4.webp');
    expect(container.querySelector('.juno-effect-special')).toHaveTextContent('+4');
  });
  it('animates only a confirmed report with the actual positive draw amount', () => {
    const { container, rerender } = render(<JunoEffects move={null} position="left" name="Bo" />);
    const move = { id: 'report', type: 'report' as const, userId: 'a', targetUserId: 'b', amount: 2 };
    rerender(<JunoEffects move={move} position="left" name="Bo" />);
    expect(container.querySelector('.juno-effect-report')).toHaveAttribute('data-from', 'left');
    expect(container.querySelectorAll('.juno-report-impact i')).toHaveLength(12);
    expect(container.querySelector('.juno-effect-report img')?.getAttribute('src')).toContain('/games/juno/ui/hammer.gif');
    expect(container.querySelector('.juno-effect-draw,.juno-effect-special')).toBeNull();
    rerender(<JunoEffects move={{ ...move, id: 'empty', amount: 0 }} position="left" name="Bo" />);
    expect(container.querySelector('.juno-effect-report')).toBeNull();
  });
  it('expires the report strike without replaying polled ids and cleans up on unmount', () => {
    vi.useFakeTimers();
    const move = { id: 'confirmed-report', type: 'report' as const, userId: 'a', targetUserId: 'b', amount: 2 };
    const { container, rerender, unmount } = render(<JunoEffects move={null} position="top" name="Bo" />);
    rerender(<JunoEffects move={move} position="top" name="Bo" />);
    expect(container.querySelector('.juno-effect-report')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1049));
    rerender(<JunoEffects move={{ ...move }} position="top" name="Bo" />);
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector('.juno-effect-report')).toBeNull();
    rerender(<JunoEffects move={{ ...move }} position="top" name="Bo" />);
    expect(container.querySelector('.juno-effect-report')).toBeNull();
    unmount(); expect(vi.getTimerCount()).toBe(0);
  });
});
