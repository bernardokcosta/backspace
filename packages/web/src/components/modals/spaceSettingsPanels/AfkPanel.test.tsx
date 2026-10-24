import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Channel, Space } from '@backspace/shared';

vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const apiUpdate = vi.fn();
vi.mock('../../../utils/crossStoreResolvers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/crossStoreResolvers')>()),
  getApiForOrigin: () => ({ spaces: { update: apiUpdate } }),
}));

import { AfkPanel } from './AfkPanel';
import { useSpaceStore } from '../../../stores/spaceStore';

const space: Space & { _instanceOrigin: string } = {
  id: 'space-1',
  name: 'Space',
  icon: null,
  banner: null,
  avatarColor: 'lavender',
  ownerId: 'user-1',
  ownerTitle: null,
  inviteCode: null,
  visibility: 'public',
  directoryListed: false,
  description: null,
  afkChannelId: null,
  afkTimeoutSeconds: 300,
  createdAt: 1,
  _instanceOrigin: '',
};

const channel = (id: string, type: Channel['type']): Channel => ({
  id, spaceId: 'space-1', name: id, type, topic: null, position: 0, categoryId: null, createdAt: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  useSpaceStore.setState({
    spaces: [space],
    channels: [channel('voice-1', 'voice'), channel('general', 'text')],
  });
});

afterEach(() => cleanup());

describe('AfkPanel', () => {
  it('lists voice channels with a disabled option, and saves the pair', async () => {
    apiUpdate.mockResolvedValue({ ...space, afkChannelId: 'voice-1', afkTimeoutSeconds: 900 });
    render(<AfkPanel spaceId="space-1" />);

    const select = screen.getByLabelText('spaces:settings.afk.channelLabel') as HTMLSelectElement;
    expect(select).toHaveValue('');
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual(['', 'voice-1']);

    fireEvent.change(select, { target: { value: 'voice-1' } });
    fireEvent.change(screen.getByLabelText('spaces:settings.afk.timeoutLabel'), { target: { value: '900' } });
    fireEvent.click(screen.getByText('common:actions.save'));

    await waitFor(() => expect(apiUpdate).toHaveBeenCalledWith('space-1', {
      afkChannelId: 'voice-1',
      afkTimeoutSeconds: 900,
    }));
  });

  it('clearing the channel disables the feature', async () => {
    useSpaceStore.setState({ spaces: [{ ...space, afkChannelId: 'voice-1', afkTimeoutSeconds: 900 }] });
    apiUpdate.mockResolvedValue({ ...space, afkChannelId: null });
    render(<AfkPanel spaceId="space-1" />);
    expect(screen.getByLabelText('spaces:settings.afk.channelLabel')).toHaveValue('voice-1');

    fireEvent.change(screen.getByLabelText('spaces:settings.afk.channelLabel'), { target: { value: '' } });
    fireEvent.click(screen.getByText('common:actions.save'));

    await waitFor(() => expect(apiUpdate).toHaveBeenCalledWith('space-1', {
      afkChannelId: null,
      afkTimeoutSeconds: 900,
    }));
  });
});
