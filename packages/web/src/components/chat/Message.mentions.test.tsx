import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DmChannel, MessageWithUser, User } from '@veyvox/shared';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { Message } from './Message';

vi.mock('../../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

function makeUser(id: string, username: string, displayName: string | null): User {
  return {
    id,
    username,
    displayName,
    avatar: null,
    banner: null,
    accentColor: null,
    avatarColor: null,
    bio: null,
    status: 'online',
    customStatus: null,
    isAdmin: false,
    createdAt: 1,
  };
}

const me = makeUser('me-orbit', 'alice@retained.invalid', 'Alice');
const meOnOrbit = makeUser('me-orbit', 'alice@home.example', 'Alice');
const kaiOnOrbit = makeUser('kai-orbit', 'kai', 'Kai');

// Native DM member IDs match the authenticated account ID exactly.
const remoteDm = {
  id: 'dm-r',
  ownerId: null,
  createdAt: 1,
  members: [meOnOrbit, kaiOnOrbit],
  lastMessage: null,
} as unknown as DmChannel;

function dmMessage(content: string): MessageWithUser {
  return {
    id: `m-${content}`,
    channelId: '',
    dmChannelId: remoteDm.id,
    userId: kaiOnOrbit.id,
    replyToId: null,
    content,
    editedAt: null,
    createdAt: 1,
    user: kaiOnOrbit,
    attachments: [],
    embeds: [],
    reactions: [],
  } as MessageWithUser;
}

function rowOf(message: MessageWithUser): HTMLElement {
  return document.getElementById(`msg-${message.id}`)!;
}

beforeEach(() => {
  useAuthStore.setState({ user: me });
  useSpaceStore.setState({
    dmChannels: [remoteDm],
  });
});

afterEach(() => {
  useAuthStore.setState({ user: null });
  useSpaceStore.setState({ dmChannels: [] });
});

describe('Message mention highlight (#332)', () => {
  it('highlights a mention of my native account ID', () => {
    const message = dmMessage(`hey <@${meOnOrbit.id}>`);
    render(<Message message={message} isCompact={false} isFirstInGroup previousMessageId={null} />);
    expect(rowOf(message).className).toContain('border-l-accent-amber');
    // The badge resolves the mention to me, in the DM's own id space.
    expect(screen.getByText('@Alice')).toBeInTheDocument();
  });

  it('does not highlight a different native account ID', () => {
    const message = dmMessage('hey <@someone-else>');
    render(<Message message={message} isCompact={false} isFirstInGroup previousMessageId={null} />);
    expect(rowOf(message).className).not.toContain('border-l-accent-amber');
  });

  it('does not highlight my token when it sits inside code', () => {
    const message = dmMessage(`the syntax is \`<@${meOnOrbit.id}>\``);
    render(<Message message={message} isCompact={false} isFirstInGroup previousMessageId={null} />);
    expect(rowOf(message).className).not.toContain('border-l-accent-amber');
  });
});
