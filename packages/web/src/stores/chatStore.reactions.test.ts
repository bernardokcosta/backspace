import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MessageWithUser, Reaction, User } from '@veyvox/shared';

// An open socket: every send is taken.
vi.mock('../hooks/useWebSocket', () => ({
  wsSend: vi.fn(() => true),
  wsSendAll: vi.fn(),
}));

vi.mock('../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

import { wsSend } from '../hooks/useWebSocket';
import { REACTION_ADD_IN_FLIGHT_MS, useChatStore } from './chatStore';
import { useAuthStore } from './authStore';

/**
 * #393: the client never sends a second `reaction_add` for a reaction the
 * user holds, whether it is stored or its add is still in flight, and a
 * `reaction_added` the store already holds is not counted twice. Whether the
 * user holds a reaction (`hasOwnReaction`, what the toggle reads) counts only
 * stored reactions, the ones the pills show.
 *
 * Ownership is the signed-in account's native ID.
 */

const CHANNEL = 'native-channel';
const MESSAGE = 'msg-1';

const me = { id: 'me', username: 'jannis', displayName: 'Jannis', avatar: null, createdAt: 1 } as User;
const mira = { id: 'mira', username: 'mira', displayName: 'Mira', avatar: null, createdAt: 1 } as User;

function message(reactions: Reaction[] = []): MessageWithUser {
  return {
    id: MESSAGE, channelId: CHANNEL, userId: 'mira', replyToId: null, content: 'hello',
    editedAt: null, createdAt: 1, user: mira, attachments: [], embeds: [], reactions,
  };
}

function reaction(id: string, user: User, emoji: string): Reaction {
  return { id, messageId: MESSAGE, userId: user.id, emoji, createdAt: 1, user };
}

function sent(type: 'reaction_add' | 'reaction_remove'): unknown[] {
  return vi.mocked(wsSend).mock.calls.filter(([event]) => (event as { type: string }).type === type);
}

function reactionsHeld(): Reaction[] {
  return useChatStore.getState().messages.get(CHANNEL)?.[0]?.reactions ?? [];
}

beforeEach(() => {
  vi.mocked(wsSend).mockClear();
  useAuthStore.setState({ user: me });
  useChatStore.setState({
    messages: new Map([[CHANNEL, [message()]]]),
    detachedChannels: new Map(),
    reactionAddsInFlight: new Map(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  useChatStore.setState({ messages: new Map(), reactionAddsInFlight: new Map() });
  useAuthStore.setState({ user: null });
});

describe('addReaction', () => {
  it('sends one add on the current socket however often it is called before the answer', () => {
    const { addReaction } = useChatStore.getState();
    addReaction(MESSAGE, '👍');
    addReaction(MESSAGE, '👍');
    addReaction(MESSAGE, '👍');
    expect(sent('reaction_add')).toEqual([[{ type: 'reaction_add', messageId: MESSAGE, emoji: '👍' }]]);
  });

  it('sends nothing for a reaction the user already has stored', () => {
    useChatStore.setState({ messages: new Map([[CHANNEL, [message([reaction('r1', me, '👍')])]]]) });
    useChatStore.getState().addReaction(MESSAGE, '👍');
    expect(sent('reaction_add')).toEqual([]);
  });

  it('sends the add when only someone else has the emoji, or the user has another', () => {
    useChatStore.setState({ messages: new Map([[CHANNEL, [message([reaction('r1', mira, '👍'), reaction('r2', me, '🎉')])]]]) });
    useChatStore.getState().addReaction(MESSAGE, '👍');
    expect(sent('reaction_add')).toHaveLength(1);
  });

  it('does not count an add the socket did not take as in flight, so the next call sends it', () => {
    vi.mocked(wsSend).mockReturnValueOnce(false);
    const { addReaction } = useChatStore.getState();
    addReaction(MESSAGE, '👍');
    expect(useChatStore.getState().reactionAddsInFlight.size).toBe(0);
    expect(useChatStore.getState().hasOwnReaction(MESSAGE, '👍')).toBe(false);

    addReaction(MESSAGE, '👍');
    expect(sent('reaction_add')).toHaveLength(2);
    expect(useChatStore.getState().reactionAddsInFlight.size).toBe(1);
  });

  it('sends the add again once an unanswered one has timed out', () => {
    vi.useFakeTimers();
    const { addReaction } = useChatStore.getState();
    addReaction(MESSAGE, '👍');
    vi.advanceTimersByTime(REACTION_ADD_IN_FLIGHT_MS - 1);
    addReaction(MESSAGE, '👍');
    expect(sent('reaction_add')).toHaveLength(1);
    vi.advanceTimersByTime(1);
    addReaction(MESSAGE, '👍');
    expect(sent('reaction_add')).toHaveLength(2);
  });

  it('drops adds that have timed out when it records a new one', () => {
    vi.useFakeTimers();
    useChatStore.setState({
      messages: new Map([[CHANNEL, [message(), { ...message(), id: 'msg-2' }]]]),
    });
    const { addReaction } = useChatStore.getState();
    addReaction(MESSAGE, '👍');
    vi.advanceTimersByTime(REACTION_ADD_IN_FLIGHT_MS / 2);
    addReaction(MESSAGE, '🎉');
    vi.advanceTimersByTime(REACTION_ADD_IN_FLIGHT_MS / 2);
    addReaction('msg-2', '👍');

    // The first add timed out; the second is still within its window.
    expect([...useChatStore.getState().reactionAddsInFlight.keys()]).toEqual([
      JSON.stringify([MESSAGE, '🎉']),
      JSON.stringify(['msg-2', '👍']),
    ]);
  });
});

describe('hasOwnReaction', () => {
  it('counts the stored reaction an add\'s answer brings, not the add in flight', () => {
    const store = useChatStore.getState();
    expect(store.hasOwnReaction(MESSAGE, '👍')).toBe(false);
    store.addReaction(MESSAGE, '👍');
    // Nothing on screen shows the add yet, so the user does not hold it.
    expect(useChatStore.getState().hasOwnReaction(MESSAGE, '👍')).toBe(false);

    useChatStore.getState().onReactionAdded(MESSAGE, reaction('r1', me, '👍'));
    expect(useChatStore.getState().reactionAddsInFlight.size).toBe(0);
    expect(useChatStore.getState().hasOwnReaction(MESSAGE, '👍')).toBe(true);
  });

  it('does not end the in-flight add when someone else\'s reaction with the emoji arrives', () => {
    useChatStore.getState().addReaction(MESSAGE, '👍');
    useChatStore.getState().onReactionAdded(MESSAGE, reaction('r1', mira, '👍'));
    expect(useChatStore.getState().reactionAddsInFlight.size).toBe(1);
    useChatStore.getState().addReaction(MESSAGE, '👍');
    expect(sent('reaction_add')).toHaveLength(1);
  });

  it('is false once the user removes the reaction, so it can be added again', () => {
    const store = useChatStore.getState();
    store.addReaction(MESSAGE, '👍');
    store.removeReaction(MESSAGE, '👍');
    expect(useChatStore.getState().hasOwnReaction(MESSAGE, '👍')).toBe(false);
    useChatStore.getState().addReaction(MESSAGE, '👍');
    expect(sent('reaction_add')).toHaveLength(2);
    expect(sent('reaction_remove')).toEqual([[{ type: 'reaction_remove', messageId: MESSAGE, emoji: '👍' }]]);
  });

  it('reads a message held by a detached window', () => {
    useChatStore.setState({
      messages: new Map(),
      detachedChannels: new Map([[CHANNEL, [message([reaction('r1', me, '👍')])]]]),
    });
    expect(useChatStore.getState().hasOwnReaction(MESSAGE, '👍')).toBe(true);
  });
});

describe('onReactionAdded', () => {
  it('keeps one reaction when the same reaction_added arrives twice', () => {
    const { onReactionAdded } = useChatStore.getState();
    onReactionAdded(MESSAGE, reaction('r1', me, '👍'));
    onReactionAdded(MESSAGE, reaction('r1', me, '👍'));
    expect(reactionsHeld().map(r => r.id)).toEqual(['r1']);
  });

  it('leaves the message and the store as they are for a reaction it already holds', () => {
    useChatStore.getState().onReactionAdded(MESSAGE, reaction('r1', me, '👍'));
    const before = useChatStore.getState();
    const heldMessage = before.messages.get(CHANNEL)![0];

    useChatStore.getState().onReactionAdded(MESSAGE, reaction('r1', me, '👍'));
    useChatStore.getState().onReactionAdded(MESSAGE, reaction('r2', me, '👍'));

    const after = useChatStore.getState();
    expect(after.messages).toBe(before.messages);
    expect(after.messages.get(CHANNEL)![0]).toBe(heldMessage);
    expect(after.detachedChannels).toBe(before.detachedChannels);
  });

  it('leaves a detached window as it is for a reaction it already holds', () => {
    useChatStore.setState({
      messages: new Map(),
      detachedChannels: new Map([[CHANNEL, [message([reaction('r1', me, '👍')])]]]),
    });
    const before = useChatStore.getState().detachedChannels;
    useChatStore.getState().onReactionAdded(MESSAGE, reaction('r1', me, '👍'));
    expect(useChatStore.getState().detachedChannels).toBe(before);

    useChatStore.getState().onReactionAdded(MESSAGE, reaction('r2', mira, '👍'));
    expect(useChatStore.getState().detachedChannels.get(CHANNEL)![0]!.reactions!.map(r => r.id)).toEqual(['r1', 'r2']);
  });

  it('keeps one reaction per user and emoji, as the server stores them', () => {
    const { onReactionAdded } = useChatStore.getState();
    onReactionAdded(MESSAGE, reaction('r1', me, '👍'));
    onReactionAdded(MESSAGE, reaction('r2', me, '👍'));
    onReactionAdded(MESSAGE, reaction('r3', mira, '👍'));
    onReactionAdded(MESSAGE, reaction('r4', me, '🎉'));
    expect(reactionsHeld().map(r => r.id)).toEqual(['r1', 'r3', 'r4']);
  });
});
