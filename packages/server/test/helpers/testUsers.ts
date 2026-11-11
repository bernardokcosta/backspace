import crypto from 'node:crypto';
import type { SpawnedInstance } from './instanceHarness.js';

export interface TestUser {
  id: string;
  username: string;
  password: string;
  token: string;
  origin: string;
}

/** Register a real native account through the production admission path. */
export async function registerLocal(instance: SpawnedInstance, baseName = 't'): Promise<TestUser> {
  const safeBase = baseName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const username = `${safeBase}_${crypto.randomBytes(4).toString('hex')}`;
  const password = `pw_${crypto.randomBytes(8).toString('hex')}`;
  const response = await fetch(`${instance.origin}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, displayName: username }),
  });
  if (!response.ok) throw new Error(`registerLocal failed: ${response.status} ${await response.text()}`);
  const body = await response.json() as { user: { id: string }; token: string };
  return { id: body.user.id, username, password, token: body.token, origin: instance.origin };
}
