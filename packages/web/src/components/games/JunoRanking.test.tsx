import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useJunoStore } from '../../stores/junoStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { JunoRanking } from './JunoRanking';
import { junoRanking, junoUser } from './junoTestFixtures';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
const originalLoad = useJunoStore.getState().loadRanking;
const load = vi.fn(async () => {});
beforeEach(() => {
  vi.clearAllMocks(); useJunoStore.getState().reset();
  useJunoStore.getState().bind({ accountId: 'a', selfId: 'a', origin: '', channelId: 'voice' }, true);
  useSpaceStore.setState({ spaceChannelIndex: new Map([['voice', { spaceId: 'space', origin: '', type: 'voice' }]]) });
  useJunoStore.setState({ loadRanking: load, ranking: { target: { accountId: 'a', selfId: 'a', origin: '', spaceId: 'space' },
    page: junoRanking(), loading: false, error: null, unsupported: false } });
});
afterEach(() => useJunoStore.setState({ loadRanking: originalLoad }));
describe('Juno space ranking screen', () => {
  it('loads the connected space, renders empty/self state, and returns without a mutation', async () => {
    const back = vi.fn(); render(<JunoRanking onBack={back} />);
    expect(load).toHaveBeenCalledWith({ accountId: 'a', selfId: 'a', origin: '', spaceId: 'space' }, { limit: 25, offset: 0 });
    expect(screen.getByText(/no completed rounds yet/i)).toBeInTheDocument();
    expect(screen.getByText(/not ranked yet/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to table' })); expect(back).toHaveBeenCalledTimes(1);
  });
  it('shows returned tied ranks and an off-page self without assembling its own ranking', () => {
    const page = junoRanking(); page.total = 50; page.offset = 25;
    page.entries = ['b', 'c'].map(id => ({ user: junoUser(id), nickname: null, rank: 2, totalXp: 160, wins: 1, completedRounds: 2 }));
    page.me = { ...page.me, rank: 1, totalXp: 240, completedRounds: 2, wins: 2 };
    useJunoStore.setState({ ranking: { ...useJunoStore.getState().ranking, page } });
    render(<JunoRanking onBack={() => {}} />); expect(screen.getAllByText('160')).toHaveLength(2);
    expect(screen.getByText('240')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
  });
  it('distinguishes an unsupported old host from a successful empty ranking', () => {
    useJunoStore.setState({ ranking: { ...useJunoStore.getState().ranking, page: null, unsupported: true } });
    render(<JunoRanking onBack={() => {}} />);
    expect(screen.getByText(/does not support Juno ranking/i)).toBeInTheDocument();
    expect(screen.queryByText(/no completed rounds yet/i)).not.toBeInTheDocument();
  });
});
