import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PinWithMessage } from '@veyvox/shared';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { PinnedMessagesPopover } from './PinnedMessagesPopover';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { junoUser } from '../games/junoTestFixtures';
const pin = (pinnedById: string | null): PinWithMessage => ({ messageId: 'm', pinnedById, message: {
  id: 'm', user: junoUser('author', 'Native Author'), createdAt: 1, content: 'Pinned content', attachments: [],
} }) as PinWithMessage;
const unpin = vi.fn(async () => {}), load = vi.fn(async () => {}), jump = vi.fn();
beforeEach(() => { vi.clearAllMocks(); useAuthStore.setState({ user: junoUser('me') }); useChatStore.setState({ loadPins: load, unpinMessage: unpin }); });
afterEach(cleanup);
describe('native pin ownership', () => {
  it.each([{ owner: 'me', manage: false, allowed: true }, { owner: 'other', manage: false, allowed: false }, { owner: null, manage: true, allowed: true }])('gates unpin by native ID or moderator bit: $owner/$manage', ({ owner, manage, allowed }) => {
    useChatStore.setState({ pinnedByChannel: new Map([['chat', [pin(owner)]]]) });
    render(<PinnedMessagesPopover open onClose={vi.fn()} anchorRef={createRef<HTMLElement>()} channelId="chat" canManageMessages={manage} onJumpToMessage={jump} />);
    expect(load).toHaveBeenCalledWith('chat'); const button = screen.queryByText('Unpin'); expect(!!button).toBe(allowed);
    if (button) { fireEvent.click(button); expect(unpin).toHaveBeenCalledWith('m', 'chat'); }
    fireEvent.click(screen.getByText('Pinned content')); expect(jump).toHaveBeenCalledWith('m');
  });
});
