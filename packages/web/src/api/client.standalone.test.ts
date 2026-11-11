import { afterEach, describe, expect, it, vi } from 'vitest';
import { VeyvoxApiClient } from './client';

afterEach(() => vi.unstubAllGlobals());
describe('native-only API surface', () => {
  it('has no S2S, registry, credential, linked-account or remote-admin entrypoints', () => {
    const client = new VeyvoxApiClient('/api', () => 'synthetic-current-token');
    expect(client).not.toHaveProperty('federation');
    for (const name of ['federationCredential', 'getFederationRegistry', 'putFederationRegistry', 'deleteFederationIdentity', 'reattach']) expect(client.users).not.toHaveProperty(name);
    expect(client.auth).not.toHaveProperty('attachProof');
    for (const name of ['listInstances', 'listBlockedBots', 'unblockBot']) expect(client.admin).not.toHaveProperty(name);
    for (const name of ['listPeers', 'setPeerPolicy', 'getRemotePacks', 'syncPack']) expect(client.admin.stickerPacks).not.toHaveProperty(name);
    for (const name of ['storageStats', 'listUsers', 'updateStatus']) expect(client.admin).toHaveProperty(name);
    expect(client.admin.stickerPacks).toHaveProperty('listReviews');
  });
  it('serializes local DM member IDs and new owner directly, with encoded path segments', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}')); vi.stubGlobal('fetch', fetch);
    const client = new VeyvoxApiClient('/api', () => 'synthetic-current-token');
    await client.dm.kickMember('dm/id', 'user/id');
    await client.dm.transferOwnership('dm/id', { newOwnerId: 'local-owner' });
    expect(fetch.mock.calls[0]).toMatchObject(['/api/dm/dm%2Fid/members/user%2Fid', { method: 'DELETE', headers: { Authorization: 'Bearer synthetic-current-token' } }]);
    expect(fetch.mock.calls[1]).toMatchObject(['/api/dm/dm%2Fid/transfer', { method: 'POST', body: JSON.stringify({ newOwnerId: 'local-owner' }) }]);
  });
  it('does not transmit removed admin query fields from an untyped caller', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}')); vi.stubGlobal('fetch', fetch);
    const client = new VeyvoxApiClient('/api', () => 'synthetic-current-token');
    const filter = { q: 'native', homeInstance: 'unused.invalid', role: 'admin' };
    const packs = { q: 'local', originType: 'replica' };
    await client.admin.listUsers(filter); await client.admin.stickerPacks.listAll(packs);
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/admin/users?q=native&role=admin');
    expect(fetch.mock.calls[1]?.[0]).toBe('/api/admin/sticker-packs?q=local');
  });
  it('an old handed-off mutation 401 cannot expire a replacement session with the same token bytes', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const expire = vi.fn();
    const client = new VeyvoxApiClient('/api', () => 'synthetic-reused-token', expire);
    const pending = client.users.update({ bio: 'old session' });
    const observed = pending.catch(error => error);
    client.cancelPendingReads(); // The existing session reset boundary.
    finish(new Response(JSON.stringify({ code: 'unauthorized' }), { status: 401 }));
    expect((await observed).status).toBe(401); expect(expire).not.toHaveBeenCalled();
  });
});
