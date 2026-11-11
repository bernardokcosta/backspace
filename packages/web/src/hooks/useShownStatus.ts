import type { UserStatus } from '@veyvox/shared';
import { selectMyChosenStatus, useAuthStore } from '../stores/authStore';

/** Self dots use the loaded own choice, while other accounts keep their live status. */
export function useShownStatus<S extends UserStatus | null | undefined>(subject: { id: string } | null | undefined, status: S): S | UserStatus {
  const selfId = useAuthStore(state => state.user?.id), chosen = useAuthStore(selectMyChosenStatus);
  return subject && selfId === subject.id && chosen ? chosen : status;
}
