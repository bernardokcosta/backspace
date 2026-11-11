import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { User } from '@veyvox/shared';

vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) } }));
vi.mock('./useWebSocket', () => ({ connectInstance: vi.fn(), disconnectInstance: vi.fn(), disconnectAllRemote: vi.fn() }));

import { useAuth } from './useAuth';
import { useAuthStore } from '../stores/authStore';
import { JoinPage } from '../components/JoinPage';

const user = { id: 'bootstrap-user', username: 'bootstrap', status: 'online' } as User;

function ProtectedPage() {
  useAuth();
  const error = useAuthStore(state => state.userLoadError);
  return error ? <button onClick={() => { void useAuthStore.getState().loadUser(); }}>Try again</button> : null;
}

beforeEach(() => {
  localStorage.setItem('backspace_token', 'bootstrap-token');
  useAuthStore.setState({ token: 'bootstrap-token', user: null, isLoading: false, error: null, userLoadError: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('does not wrap the API client one-shot scoped recovery in another bootstrap loop', async () => {
  vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: 'rate_limited', retryAfter: 1, rateLimitScope: 'http' }), { status: 429 }));
  vi.stubGlobal('fetch', fetcher);
  render(<MemoryRouter><ProtectedPage /></MemoryRouter>);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(useAuthStore.getState()).toMatchObject({ token: 'bootstrap-token', user: null, userLoadError: expect.any(String) });
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

describe.each(['protected', 'invite'] as const)('bounded %s session bootstrap', page => {
  it.each([502, 429])('stops automatic attempts after HTTP%s with no loaded user, but allows explicit retry', async status => {
    let reads = 0; let healthy = false;
    vi.stubGlobal('fetch', vi.fn(async (target: string) => {
      if (String(target).endsWith('/users/@me')) {
        reads++;
        // Cap the buggy reproduction instead of leaving a tight infinite loop.
        if (!healthy && reads <= 5) return new Response(JSON.stringify({ code: status === 429 ? 'rate_limited' : 'internal_error' }), { status });
        return new Response(JSON.stringify(user));
      }
      return new Response(JSON.stringify({ spaceId: 'space', spaceName: 'Local invite', memberCount: 1, instanceName: 'Local' }));
    }));
    render(<MemoryRouter initialEntries={['/join/local-code']}><Routes><Route path="/join/:inviteCode" element={page === 'invite' ? <JoinPage /> : <ProtectedPage />} /></Routes></MemoryRouter>);
    await waitFor(() => { expect(reads).toBeGreaterThan(0); expect(useAuthStore.getState().isLoading).toBe(false); });
    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(reads).toBe(1);
    expect(useAuthStore.getState()).toMatchObject({ token: 'bootstrap-token', user: null, userLoadError: expect.any(String) });
    healthy = true;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(useAuthStore.getState().user?.id).toBe(user.id));
    expect(reads).toBe(2);
    expect(useAuthStore.getState().userLoadError).toBeNull();
  });
});
