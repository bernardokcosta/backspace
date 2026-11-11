import { isChosenUserStatus, type User } from '@veyvox/shared';

/** Minimal native state for tests that replace the auth module's import graph. */
export interface MockAuthState {
  user: (Partial<User> & Pick<User, 'id'>) | null;
  sessionRevision?: number;
  [extra: string]: unknown;
}

export function authStoreMock(read: () => MockAuthState) {
  const full = () => ({ token: 't', sessionRevision: 0, ...read() });
  const useAuthStore = Object.assign(
    <T,>(selector: (state: ReturnType<typeof full>) => T): T => selector(full()),
    {
      getState: full,
      setState: (patch: Partial<MockAuthState>) => { Object.assign(read(), patch); },
      subscribe: () => () => {},
    },
  );
  return {
    useAuthStore,
    selectMyChosenStatus: (state: Pick<MockAuthState, 'user'>) =>
      isChosenUserStatus(state.user?.status) ? state.user.status : null,
  };
}
