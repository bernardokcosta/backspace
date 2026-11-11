import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DmChannel } from '@veyvox/shared';
import { useUnreadCountStore } from '../../stores/unreadCountStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useChatStore } from '../../stores/chatStore';
import { DmUnreadBadge } from './DmUnreadBadge';

vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) } }));
vi.mock('../../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));

beforeEach(() => {
  useUnreadCountStore.getState().reset();
  useSpaceStore.setState({ dmChannels: [{ id: 'a' }, { id: 'b' }] as DmChannel[] });
  useChatStore.setState({ unreadChannels: new Set(['a', 'b']) });
});

describe('DM unread message badge', () => {
  it('sums each native conversation once, excluding unknown channels', () => {
    useUnreadCountStore.getState().hydrate({ a: 3, b: 5, unknown: 999 });
    render(<DmUnreadBadge />);
    expect(screen.getByText('8')).toHaveClass('bg-notification');
    expect(screen.getByText('8 unread direct messages')).toBeInTheDocument();
  });

  it('caps the number at 99+ and says so in the label', () => {
    useUnreadCountStore.getState().hydrate({ a: 100 });
    render(<DmUnreadBadge />);
    expect(screen.getByText('99+')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('More than 99 unread direct messages')).toBeInTheDocument();
  });

  it('uses the singular for one message', () => {
    useUnreadCountStore.getState().hydrate({ a: 1 });
    render(<DmUnreadBadge />);
    expect(screen.getByText('1 unread direct message')).toBeInTheDocument();
  });

  it('clears once the conversations are read', () => {
    useUnreadCountStore.getState().hydrate({ a: 4 });
    useChatStore.setState({ unreadChannels: new Set() });
    expect(render(<DmUnreadBadge />).container).toBeEmptyDOMElement();
  });

  it('shows nothing when the instance sent no counts', () => {
    useUnreadCountStore.getState().hydrate(undefined);
    expect(render(<DmUnreadBadge />).container).toBeEmptyDOMElement();
  });
});
