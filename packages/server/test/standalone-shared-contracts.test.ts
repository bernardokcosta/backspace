import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as shared from '@veyvox/shared';
import { isErrorCode } from '@veyvox/shared/src/errors';
import { diagnosticError, diagnosticRoute } from '@veyvox/shared/src/diagnostics';

describe('shared standalone contract retirement', () => {
  it('exports no peer/replica/identity/credential/relay contracts or constant-return predicates', () => {
    const types = readFileSync(new URL('../../shared/src/types.ts', import.meta.url), 'utf8');
    expect(types).not.toMatch(/Federat|Replicated|Peering|PeerEnsure|AttachProof|Reattach|PresenceIdentity|DmCallUndeliverable|ownsChosenStatus|detachedHomeOf|homeUserId|homeInstance|AdminBlockedBot/);
    for (const name of ['PEER_ENSURE_REASONS', 'ownsChosenStatus', 'detachedHomeOf']) expect(shared).not.toHaveProperty(name);
    expect(shared.isChosenUserStatus('dnd')).toBe(true);
    expect(shared.isChosenUserStatus('offline')).toBe(false);
  });
  it.each(['peer_rejected', 'peer_pending', 'peer_pending_approval', 'peer_pending_local_admin', 'peer_unreachable',
    'PEER_EXISTS_RESET_REQUIRED', 'PEER_REVOKED', 'PEER_HANDSHAKE_IN_PROGRESS', 'peer_reset_pending',
    'home_instance_invalid', 'replicated_username_format_required', 'federated_registration_closed',
    'profile_managed_by_home', 'registry_conflict', 'federation_credential_remote_only',
    'federation_credential_home_only', 'federation_credential_failed', 'federation_different_password',
    'bot_home_not_peered', 'bot_proof_invalid', 'bot_revocation_pending', 'bot_blocked',
    'bot_block_not_federated', 'blocked_bot_not_found', 'federated_user_cannot_be_admin',
    'federated_user_password_managed_by_home', 'sticker_peer_blocked', 'relay_ttl_out_of_range',
    'rotation_interval_out_of_range'])('retired error %s is not an accepted diagnostic/catalog code', code => {
    expect(isErrorCode(code)).toBe(false);
    expect(diagnosticError({ name: 'Error', code })).toEqual({ errorName: 'Error' });
  });
  it('redacts retired route words rather than treating them as native vocabulary', () => {
    expect(diagnosticRoute('/api/federation/relay')).toBe('/api/:id/:id');
    expect(diagnosticRoute('/api/users/@me/federation-registry')).toBe('/api/users/@me/:id');
    expect(diagnosticRoute('/api/users/@me/federation-credential')).toBe('/api/users/@me/:id');
    expect(diagnosticRoute('/api/users/@me/change-password')).toBe('/api/users/@me/change-password');
  });
});
