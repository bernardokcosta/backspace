import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@backspace/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) } }));
vi.mock('./instanceStore', () => ({ useInstanceStore: { getState: () => ({ _autoConnectDone: true, instances: [] }), subscribe: () => () => {} } }));
import { usePendingMessageStore } from './pendingMessageStore';
import { useTransferStore } from './transferStore';
import { useSpaceStore } from './spaceStore';
import { startPendingMessageOrchestrator } from './pendingMessageRehydrate';
import { setDesktopSessionAllowed } from '../utils/desktopSessionAccess';
let stop: (() => void) | undefined;
afterEach(() => { stop?.(); setDesktopSessionAllowed(true); vi.restoreAllMocks(); usePendingMessageStore.setState({ bubbles: new Map() }); });
describe('confirmed pending delivery with the real API/store/orchestrator', () => {
  it('does not resend an HTTP-confirmed message when its body completes after blocking', async () => {
    setDesktopSessionAllowed(true); useTransferStore.setState({ transfers: new Map() });
    usePendingMessageStore.setState({ bubbles: new Map() }); useSpaceStore.getState().reset();
    const channel: Channel = { id: 'receipt-channel', spaceId: 'space', name: 'receipt', type: 'text', topic: null, position: 0, categoryId: null, createdAt: 1, myPermissions: '1' };
    useSpaceStore.getState().upsertChannel(channel, 'space', '');
    const transfer = useTransferStore.getState().createTransfer({ type: 'upload', file: { name: 'draft', size: 1, mimetype: 'text/plain' }, tray: false });
    useTransferStore.getState().setAttachmentRef(transfer, 'attachment', 'draft'); useTransferStore.getState().setState_(transfer, 'completed');
    let finish: (body: unknown) => void = () => {};
    const body = new Promise((resolve) => { finish = resolve; });
    const confirmed = new Response('{}', { status: 200 });
    vi.spyOn(confirmed, 'json').mockImplementation(() => body);
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(confirmed);
    usePendingMessageStore.getState().append({ clientId: 'receipt', channelId: channel.id, content: 'Deliver once', replyToId: null,
      transferIds: [transfer], createdAtLocal: Date.now(), tusExpiresAt: Date.now() + 60_000, state: 'sending', retryCount: 0 });
    stop = startPendingMessageOrchestrator();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    setDesktopSessionAllowed(false); stop();
    finish({ id: 'delivered' }); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(usePendingMessageStore.getState().bubbles.get(channel.id) ?? []).toEqual([]);
    setDesktopSessionAllowed(true); stop = startPendingMessageOrchestrator();
    await new Promise((resolve) => setTimeout(resolve, 0)); expect(fetcher).toHaveBeenCalledOnce();
  });
});
