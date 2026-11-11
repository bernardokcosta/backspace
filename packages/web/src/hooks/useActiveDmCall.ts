import { useVoiceStore } from '../stores/voiceStore';
import { useSpaceStore } from '../stores/spaceStore';
import { useAuthStore } from '../stores/authStore';
import { formatDmHeaderName } from '../utils/dmFormatters';

/**
 * The conversation of the DM call the client is in, as this client can open
 * it: the native navigation ID and the DM header's title.
 */
export function useActiveDmCall(): { dmChannelId: string | null; title: string | null } {
  const activeDmCall = useVoiceStore((s) => s.activeDmCall);
  const dmChannels = useSpaceStore((s) => s.dmChannels);
  const dmChannelId = activeDmCall?.dmChannelId ?? null;
  const dm = dmChannelId ? dmChannels.find((d) => d.id === dmChannelId) : undefined;
  const selfId = useAuthStore(s => s.user?.id ?? null);
  return { dmChannelId, title: dm ? formatDmHeaderName(dm, selfId) : null };
}
