import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageWithUser } from '@veyvox/shared';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
const mocks = vi.hoisted(() => ({ channel: vi.fn(), dm: vi.fn() }));
vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), api: { search: mocks } }));
import { SearchPopover } from './SearchPopover';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { junoUser } from '../games/junoTestFixtures';
const message = { id: 'm', content: 'native matching text', createdAt: 1, user: junoUser('author', 'Native Author'), attachments: [] } as unknown as MessageWithUser;
const response = { results: [message], totalCount: 1 };
beforeEach(() => { vi.clearAllMocks(); useSpaceStore.getState().reset(); mocks.channel.mockResolvedValue(response); mocks.dm.mockResolvedValue(response); });
afterEach(cleanup);
const mount = (isDm = false) => render(<SearchPopover open onClose={vi.fn()} anchorRef={createRef<HTMLElement>()} channelId="chat" isDm={isDm} onJumpToMessage={vi.fn()} />);
describe('native message search', () => {
  it.each([false, true])('uses only the native %s endpoint and channel ID', async isDm => {
    mount(isDm); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'matching' } });
    expect(await screen.findByText('Native Author')).toBeInTheDocument();
    expect(isDm ? mocks.dm : mocks.channel).toHaveBeenCalledWith('chat', expect.objectContaining({ q: 'matching', offset: 0, limit: 25 }));
    expect(isDm ? mocks.channel : mocks.dm).not.toHaveBeenCalled();
  });
  it.each(['query-cleared', 'session-replaced'] as const)('rejects a late search response after %s', async reason => {
    let finish!: (data: typeof response) => void; mocks.channel.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = mount(); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'matching' } }); await waitFor(() => expect(mocks.channel).toHaveBeenCalledOnce());
    if (reason === 'query-cleared') fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    else act(() => useAuthStore.setState(s => ({ sessionRevision: s.sessionRevision + 1 })));
    await act(async () => finish(response)); expect(screen.queryByText('Native Author')).toBeNull();
    await waitFor(() => expect(view.baseElement.querySelector('.animate-spin')).toBeNull());
  });
});
