import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n, { setLanguage } from '../i18n';
import { HttpError } from '../api/client';
import { waitForTransferAttachment } from './waitForTransfer';
import { deleteAccountOnRemotes } from './federationOps';

const fixtures = vi.hoisted(() => ({ transfers: new Map<string, { state: string }>(), instances: [] as unknown[] }));
vi.mock('../stores/transferStore', () => ({ useTransferStore: { getState: () => ({ transfers: fixtures.transfers }), subscribe: vi.fn() } }));
vi.mock('../stores/instanceStore', () => ({ useInstanceStore: { getState: () => ({ instances: fixtures.instances }) } }));

afterEach(async () => { await setLanguage('en'); fixtures.transfers.clear(); fixtures.instances = []; });

describe('helper failure copy', () => {
  it('localizes an empty terminal transfer reason', async () => {
    await setLanguage('pt');
    fixtures.transfers.set('fixture', { state: 'failed' });
    await expect(waitForTransferAttachment('fixture')).rejects.toThrow('Erro no upload');
  });
  it('uses existing error-code copy for remote deletion results', async () => {
    await setLanguage('pt');
    fixtures.instances = [{ origin: 'https://fixture.example.test', status: 'connected', api: { users: { deleteAccount: async () => { throw new HttpError(403, 'Forbidden', undefined, 'forbidden'); } } } }];
    expect(await deleteAccountOnRemotes()).toEqual([{ origin: 'https://fixture.example.test', success: false, error: i18n.t('errors:forbidden') }]);
  });
});
