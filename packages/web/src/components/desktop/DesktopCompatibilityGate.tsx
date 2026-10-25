import { useEffect, type ReactNode } from 'react';
import { useDesktopCompatibilityStore } from '../../stores/desktopCompatibilityStore';
import { useUpdateStore } from '../../stores/updateStore';
import { startPendingMessageOrchestrator } from '../../stores/pendingMessageRehydrate';
import { disconnectAllRemote } from '../../hooks/useWebSocket';
import { useVoiceStore } from '../../stores/voiceStore';
import { useScreenShareSetupStore } from '../../stores/screenShareSetupStore';
import { RequiredDesktopUpdate } from './RequiredDesktopUpdate';
import { captureDesktopSessionWork, isDesktopSessionAllowed } from '../../utils/desktopSessionAccess';

function AllowedDesktopSession({ children }: { children: ReactNode }) {
  useEffect(() => {
    const session = captureDesktopSessionWork();
    const stopPending = startPendingMessageOrchestrator();
    return () => {
      stopPending();
      // A later allowed epoch may already have restored sockets before this
      // retired effect cleans up. Do not close that new transport lifecycle.
      if (session.isCurrent() || !isDesktopSessionAllowed()) disconnectAllRemote();
      useScreenShareSetupStore.getState().close();
      const voice = useVoiceStore.getState();
      voice.handleForceDisconnect();
      voice.setIncomingCall(null);
      voice.setOutgoingCall(null);
      // AppLayout/useLiveKit cleanup retires room, mic, camera and native
      // capture, including negotiation still in flight. Tokens/drafts stay.
    };
  }, []);
  return <>{children}</>;
}

export function DesktopCompatibilityGate({ children }: { children: ReactNode }) {
  const phase = useDesktopCompatibilityStore((s) => s.phase);
  const initialize = useDesktopCompatibilityStore((s) => s.initialize);
  const initializeUpdates = useUpdateStore((s) => s.initialize);
  useEffect(() => initialize(), [initialize]);
  // Recovery survives replacement of the entire ordinary application subtree.
  useEffect(() => initializeUpdates(), [initializeUpdates]);
  return phase === 'allowed' ? <AllowedDesktopSession>{children}</AllowedDesktopSession> : <RequiredDesktopUpdate />;
}
