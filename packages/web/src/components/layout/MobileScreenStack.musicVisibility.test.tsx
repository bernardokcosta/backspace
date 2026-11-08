import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUIStore } from '../../stores/uiStore';
import { MobileScreenStack } from './MobileScreenStack';
import { useMobileScreenVisible } from './MobileScreenVisibility';
function Probe({ name }: { name: string }) { return <output data-testid={name}>{String(useMobileScreenVisible())}</output>; }
afterEach(() => vi.useRealTimers());
describe('actual settled mobile screen visibility', () => {
  it('keeps retained and animating screens inactive until the real top view settles', () => {
    vi.useFakeTimers(); useUIStore.setState({ mobileStack: [{ screen: 'voice-full' }] });
    render(<MobileScreenStack rootScreen={<Probe name="root" />} screenMap={{ 'voice-full': () => <Probe name="voice" />, chat: () => <Probe name="chat" /> }} />);
    expect(screen.getByTestId('voice')).toHaveTextContent('true'); expect(screen.getByTestId('root')).toHaveTextContent('false');
    act(() => useUIStore.getState().pushMobileScreen('chat'));
    expect(screen.getByTestId('voice')).toHaveTextContent('false'); expect(screen.getByTestId('chat')).toHaveTextContent('false');
    act(() => vi.advanceTimersByTime(40)); expect(screen.getByTestId('chat')).toHaveTextContent('true');
    act(() => useUIStore.getState().popMobileScreen());
    expect(screen.getByTestId('voice')).toHaveTextContent('false'); expect(screen.getByTestId('chat')).toHaveTextContent('false');
    act(() => vi.advanceTimersByTime(199)); expect(screen.getByTestId('voice')).toHaveTextContent('false');
    act(() => vi.advanceTimersByTime(1)); expect(screen.getByTestId('voice')).toHaveTextContent('true');
  });
});
