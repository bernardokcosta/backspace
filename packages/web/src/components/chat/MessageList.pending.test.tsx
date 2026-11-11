import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MessageWithUser, User } from '@veyvox/shared';

vi.mock('../../hooks/useWebSocket', () => ({
  wsSend: vi.fn(),
}));

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

const latestMessages = vi.fn();
vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  api: {
    channels: {
      messages: (...args: unknown[]) => latestMessages(...args),
      messagesAround: vi.fn(),
      messagesAfter: () => new Promise<never>(() => {}),
    },
  },
}));

import { MessageList } from './MessageList';
import { useChatStore } from '../../stores/chatStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { usePendingMessageStore, type PendingBubble } from '../../stores/pendingMessageStore';
import { ALL_PERMISSIONS, permissionsToString } from '../../utils/permissions';

// Pending uploads are authored by the current native account, never a copied row.
const CHANNEL = 'orbit-chan';

const me = { id: 'n-1', username: 'jannis', displayName: 'Jannis', avatar: null, createdAt: 1 } as User;
const orbitMira = { id: 'mira', username: 'mira', displayName: 'Mira', avatar: null, createdAt: 1 } as User;

const miraMessage: MessageWithUser = {
  id: 'm1', channelId: CHANNEL, userId: orbitMira.id, replyToId: null, content: 'hi from mira',
  editedAt: null, createdAt: 1_700_000_000_000, user: orbitMira, attachments: [], embeds: [], reactions: [],
};

const bubble: PendingBubble = {
  clientId: 'c1', channelId: CHANNEL, content: 'my upload', replyToId: null, transferIds: [],
  createdAtLocal: 1_700_000_030_000, state: 'sending', tusExpiresAt: Number.MAX_SAFE_INTEGER, retryCount: 0,
  origin: window.location.origin, uploaderUserId: me.id,
};

function renderList() {
  return render(
    <MemoryRouter>
      <MessageList channelId={CHANNEL} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  latestMessages.mockReset();
  latestMessages.mockResolvedValue([miraMessage]);
  useAuthStore.setState({ user: me });
  useSpaceStore.setState({
    spaceChannelIndex: new Map([[CHANNEL, { spaceId: 'space', type: 'text' }]]),
    channelPermissions: new Map([[CHANNEL, permissionsToString(ALL_PERMISSIONS)]]),
    dmChannels: [],
    members: [],
  });
  useChatStore.setState({ messages: new Map([[CHANNEL, [miraMessage]]]), hasMore: new Map(), scrollPositions: new Map(), readStates: new Map() });
  usePendingMessageStore.setState({ bubbles: new Map([[CHANNEL, [bubble]]]) });
});

afterEach(() => {
  vi.restoreAllMocks();
  usePendingMessageStore.setState({ bubbles: new Map() });
  useChatStore.setState({ messages: new Map(), hasMore: new Map(), scrollPositions: new Map() });
  useSpaceStore.setState({ spaceChannelIndex: new Map(), channelPermissions: new Map(), members: [] });
  useAuthStore.setState({ user: null });
});

describe('native pending upload bubbles', () => {
  it('does not present earlier account content as a replacement account message', () => {
    useAuthStore.setState({ user: { ...me, id: 'replacement' } }); renderList();
    expect(screen.queryByText('my upload')).toBeNull();
    act(() => useAuthStore.setState({ user: me }));
    expect(screen.getByText('my upload')).toBeInTheDocument();
  });
  it('uses the native authenticated profile, separate from another author', async () => {
    const openUserProfile = vi.fn();
    useUIStore.setState({ openUserProfile });
    renderList();
    await screen.findByText('my upload');

    // A pending upload is never folded into a different author's message group.
    fireEvent.click(await screen.findByText('Jannis'));
    expect(openUserProfile).toHaveBeenCalledTimes(1);
    const [row, anchor] = openUserProfile.mock.calls[0] as [User, DOMRect];
    expect(anchor).toMatchObject({ top: 0, left: 0 });
    expect(row).toBe(me);
  });

  it('carry the session row on the page instance', async () => {
    const openUserProfile = vi.fn();
    useUIStore.setState({ openUserProfile });
    const other = { ...orbitMira, id: 'n-2' } as User;
    const otherMessage = { ...miraMessage, userId: 'n-2', user: other };
    latestMessages.mockResolvedValue([otherMessage]);
    useChatStore.setState({ messages: new Map([[CHANNEL, [otherMessage]]]) });
    renderList();
    await screen.findByText('my upload');
    fireEvent.click(await screen.findByText('Jannis'));
    const [row, anchor] = openUserProfile.mock.calls[0] as [User, DOMRect];
    expect(anchor).toMatchObject({ top: 0, left: 0 });
    expect(row).toBe(me);
  });
});
