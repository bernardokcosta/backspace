import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n';
import { waitForTransferAttachment } from './waitForTransfer';

const fixtures = vi.hoisted(() => ({ transfers: new Map<string, { state: string }>() }));
vi.mock('../stores/transferStore', () => ({ useTransferStore: { getState: () => ({ transfers: fixtures.transfers }), subscribe: vi.fn() } }));

afterEach(async () => { await setLanguage('en'); fixtures.transfers.clear(); });

describe('helper failure copy', () => {
  it('localizes an empty terminal transfer reason', async () => {
    await setLanguage('pt');
    fixtures.transfers.set('fixture', { state: 'failed' });
    await expect(waitForTransferAttachment('fixture')).rejects.toThrow('Erro no upload');
  });
});
