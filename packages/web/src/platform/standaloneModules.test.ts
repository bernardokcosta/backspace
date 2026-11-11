import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Literal retired implementation paths, not a broad ban on remote media or URLs.
describe('retired identity/copy modules are physically absent', () => {
  it.each([
    '../stores/dmConversations.ts', '../utils/dmConversationKey.ts', '../utils/dmOriginFailover.ts', '../utils/presenceSubject.ts',
    '../utils/groupDmOwnerActions.ts', '../utils/dmChannelLookup.ts', '../utils/mutuals.ts', '../utils/friendRequestTarget.ts', '../hooks/useDmViewer.ts',
    '../utils/federationOps.ts', '../hooks/useFederationToasts.ts', '../hooks/useSpaceOrigin.ts',
    '../stores/instanceStore.ts', '../stores/federationStore.ts', '../utils/crossStoreResolvers.ts', '../utils/selfStatus.ts', '../utils/peerRejectedToast.ts',
    '../components/modals/ConnectedInstances.tsx', '../components/modals/RemotePasswordStep.tsx', '../components/modals/ReauthForm.tsx',
    '../components/modals/settingsPanels/ConnectionsPanel.tsx', '../components/modals/instanceSettingsPanels/FederationPanel.tsx',
    '../dev/peer-states-preview.tsx', '../dev/peering-reasons-preview.tsx',
    '../utils/callUndeliverableToast.ts', '../i18n/registryErrors.ts',
  ])('%s has no compatibility stub', path => {
    expect(existsSync(new URL(path, import.meta.url))).toBe(false);
  });
});
