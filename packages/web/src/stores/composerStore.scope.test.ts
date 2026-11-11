import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { useComposerStore } from './composerStore';
import { useAuthStore } from './authStore';
import { useTransferStore } from './transferStore';
import { junoUser } from '../components/games/junoTestFixtures';
beforeEach(() => { useComposerStore.setState({ states: new Map() }); useAuthStore.setState({ user: junoUser('owner') }); });
describe('native composer ownership', () => {
  it('preserves separate drafts and reply targets when accounts share a channel ID', () => {
    useComposerStore.getState().setDraft('channel', 'Private draft');
    useComposerStore.getState().setReplyTo('channel', { id: 'reply', userId: 'target', content: 'Private reply' });
    useAuthStore.setState({ user: junoUser('next') });
    expect(useComposerStore.getState().get('channel')).toMatchObject({ draftText: '', replyTo: null });
    useComposerStore.getState().setDraft('channel', 'Next draft');
    useAuthStore.setState({ user: junoUser('owner') });
    expect(useComposerStore.getState().get('channel')).toMatchObject({ draftText: 'Private draft', replyTo: { id: 'reply' } });
  });
  it('does not display or overwrite an unowned legacy text draft after a new login', () => {
    const legacy = { draftText: 'Legacy private', replyTo: null, stagedTransferIds: [] };
    useComposerStore.setState({ states: new Map([['channel', legacy]]) });
    expect(useComposerStore.getState().get('channel').draftText).toBe('');
    useComposerStore.getState().setDraft('channel', 'New draft');
    expect(useComposerStore.getState().states.get('channel')).toEqual(legacy);
  });
  it('recovers legacy staged work only with the original native transfer ownership', () => {
    const id = useTransferStore.getState().createTransfer({ type: 'upload', tray: false, file: { name: 'native', size: 1, mimetype: 'text/plain' } });
    useComposerStore.setState({ states: new Map([['channel', { draftText: 'Native draft', replyTo: null, stagedTransferIds: [id] }]]) });
    expect(useComposerStore.getState().get('channel').draftText).toBe('Native draft');
    useAuthStore.setState({ user: junoUser('next') });
    expect(useComposerStore.getState().get('channel').stagedTransferIds).toEqual([]);
  });
});
