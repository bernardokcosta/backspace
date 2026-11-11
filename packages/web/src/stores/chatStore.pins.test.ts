import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MessageWithUser, PinWithMessage, User } from '@veyvox/shared';

vi.mock('../hooks/useWebSocket', () => ({
  wsSend: vi.fn(),
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

const pinsApi = vi.hoisted(() => ({ pins: vi.fn() }));
const deleteApi = vi.hoisted(() => ({ delete: vi.fn() }));
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: { channels: { pins: pinsApi.pins }, messages: { delete: deleteApi.delete } },
}));

import { useChatStore } from './chatStore';
import { useSpaceStore } from './spaceStore';
import { useAuthStore } from './authStore';
import { HttpError } from '../api/client';

const CH = 'chat-1';
const me = { id: 'u-1', username: 'jannis', displayName: 'Jannis', avatar: null, createdAt: 1 } as User;

const message = (content: string): MessageWithUser => ({
  id: 'm-1', channelId: CH, userId: me.id, replyToId: null, content,
  type: 'user', editedAt: null, createdAt: 1, user: me, attachments: [], embeds: [], reactions: [],
});

const pin = (msg: MessageWithUser | null): PinWithMessage => ({
  id: 'p-1', channelId: CH, messageId: 'm-1', pinnedById: me.id, createdAt: 2, message: msg,
});

function board(): PinWithMessage[] {
  return useChatStore.getState().pinnedByChannel.get(CH) ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: me } as never);
  useSpaceStore.setState({ spaceChannelIndex: new Map([[CH, { spaceId: 'space', type: 'text' }]]) });
  useChatStore.setState({
    messages: new Map([[CH, [message('before')]]]),
    pinnedByChannel: new Map([[CH, [pin(message('before'))]]]),
  });
});

afterEach(() => {
  useChatStore.setState({ messages: new Map(), pinnedByChannel: new Map() });
});

describe('pin board session hygiene', () => {
  it('waits for metadata instead of guessing a home text endpoint for an unknown channel', async () => {
    useSpaceStore.setState({ spaceChannelIndex: new Map() });
    await useChatStore.getState().loadPins(CH);
    expect(pinsApi.pins).not.toHaveBeenCalled();
  });
  it('removes boards with deleted channel state and rejects late responses', async () => {
    let finish!: (v: { pins: PinWithMessage[] }) => void;
    pinsApi.pins.mockReturnValueOnce(new Promise(r => { finish = r; }));
    const loading = useChatStore.getState().loadPins(CH);
    useChatStore.getState().removeChannelStates(new Set([CH]));
    expect(board()).toEqual([]);
    finish({ pins: [pin(message('stale'))] }); await loading;
    expect(board()).toEqual([]);
  });
  it('does not let an older GET overwrite a newer pin board', async () => {
    let old!: (v: { pins: PinWithMessage[] }) => void;
    pinsApi.pins.mockReturnValueOnce(new Promise(r => { old = r; })).mockResolvedValueOnce({ pins: [pin(message('new'))] });
    const loading = useChatStore.getState().loadPins(CH);
    await useChatStore.getState().loadPins(CH);
    old({ pins: [pin(message('old'))] }); await loading;
    expect(board()[0]?.message?.content).toBe('new');
  });
  it('rejects an old GET across a reset followed by login to the same account', async () => {
    let finish!: (v: { pins: PinWithMessage[] }) => void;
    pinsApi.pins.mockReturnValueOnce(new Promise(r => { finish = r; }));
    const loading = useChatStore.getState().loadPins(CH);
    useChatStore.getState().clearAllMessages();
    finish({ pins: [pin(message('stale'))] }); await loading;
    expect(board()).toEqual([]);
  });
  it('rejects pins if the channel changed space or kind while loading', async () => {
    let finish!: (v: { pins: PinWithMessage[] }) => void;
    pinsApi.pins.mockReturnValueOnce(new Promise(r => { finish = r; }));
    const loading = useChatStore.getState().loadPins(CH);
    useChatStore.setState({ pinnedByChannel: new Map() });
    useSpaceStore.setState({ spaceChannelIndex: new Map([[CH, { spaceId: 'other-space', type: 'text' }]]) });
    finish({ pins: [pin(message('stale'))] }); await loading;
    expect(board()).toEqual([]);
  });
  it('never queries text-only pins for a voice channel', async () => {
    useSpaceStore.setState({ spaceChannelIndex: new Map([[CH, { spaceId: 'space', type: 'voice' }]]) });
    await useChatStore.getState().loadPins(CH);
    expect(pinsApi.pins).not.toHaveBeenCalled();
  });
  it('clearAllMessages drops the boards with everything else', () => {
    expect(board()).toHaveLength(1);
    useChatStore.getState().clearAllMessages();
    expect(useChatStore.getState().pinnedByChannel.size).toBe(0);
  });

  it('a load that resolves after logout does not repopulate the board', async () => {
    let resolve: (v: { pins: PinWithMessage[] }) => void = () => {};
    pinsApi.pins.mockReturnValueOnce(new Promise((res) => { resolve = res; }));
    const loading = useChatStore.getState().loadPins(CH);
    useChatStore.getState().clearAllMessages();
    useAuthStore.setState({ user: null } as never);
    resolve({ pins: [pin(message('stale'))] });
    await loading;
    expect(useChatStore.getState().pinnedByChannel.size).toBe(0);
  });
});

describe('pin board follows edits and deletes', () => {
  it('updateMessage patches the hydrated pin copy', () => {
    useChatStore.getState().updateMessage(message('after'));
    expect(board()[0]?.message?.content).toBe('after');
  });

  it('updateMessage patches the pin even when the timeline forgot the message', () => {
    useChatStore.setState({ messages: new Map() });
    useChatStore.getState().updateMessage(message('after'));
    expect(board()[0]?.message?.content).toBe('after');
  });

  it('removeMessage drops the pin entry with the timeline row', () => {
    useChatStore.getState().removeMessage('m-1', CH);
    expect(board()).toHaveLength(0);
    expect(useChatStore.getState().messages.get(CH)).toHaveLength(0);
  });

  it('removeMessage drops the pin even when the timeline forgot the message', () => {
    useChatStore.setState({ messages: new Map() });
    useChatStore.getState().removeMessage('m-1', CH);
    expect(board()).toHaveLength(0);
  });

  it('a refused delete rolls the pin back into place', async () => {
    deleteApi.delete.mockRejectedValueOnce(new HttpError(500, 'nope', undefined, 'internal_error'));
    await useChatStore.getState().deleteMessage('m-1', CH);
    expect(useChatStore.getState().messages.get(CH)).toHaveLength(1);
    expect(board().map((p) => p.messageId)).toEqual(['m-1']);
  });

  it('a 404 delete keeps the pin dropped: the server cascaded it', async () => {
    deleteApi.delete.mockRejectedValueOnce(new HttpError(404, 'gone', undefined, 'message_not_found'));
    await useChatStore.getState().deleteMessage('m-1', CH);
    expect(board()).toHaveLength(0);
  });
});
