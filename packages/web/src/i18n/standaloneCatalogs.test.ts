import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@veyvox/shared/src/errors';
import { namespaces } from './resources';
const catalogs = import.meta.glob<Record<string, unknown>>('../locales/*/*.json', { eager: true, import: 'default' });
const retired: Record<string, string[]> = {
  admin: ['general.instanceName.description', 'registration.description', 'registration.federated', 'users.filters.allInstances', 'users.filters.localOnly',
    'users.actions.federatedNoAdmin', 'users.actions.federatedNoReset', 'users.deleteDialog.blockBot', 'users.deleteDialog.blockBotHint', 'users.blockedBots', 'mobile.sections.federation'],
  auth: ['join.otherInstance', 'join.domain', 'join.connect', 'join.fallback', 'join.errors.connectFailed', 'join.errors.domainOnly'],
  chat: ['list.welcome.group.federatedNotice', 'list.welcome.dm.federatedNotice', 'attachment.federation', 'stickers.replicaBadge', 'stickers.sourceInstance', 'stickers.localInstance'],
  dm: ['callDelivery', 'feedback', 'groupInfo.federated', 'ownerActions'],
  mobile: ['you.homeInstance'],
  settings: ['nav.tabs.connections', 'account.detached', 'account.details.status.homeUnavailable', 'account.deletion.federation', 'connections', 'instance.tabs.federation'],
  social: ['friend.viaInstance', 'add.hint', 'instanceNotConnected'],
  spaces: ['join.connect', 'join.fallback', 'sidebar.space.reconnecting', 'sidebar.space.remoteInstance'],
};
function at(catalog: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, part) => value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined, catalog);
}
describe('standalone catalog retirement across every language', () => {
  it('does not bundle or lazy-load the removed namespace', () => {
    expect(namespaces).not.toContain('federation'); expect(Object.keys(catalogs).filter(path => path.endsWith('/federation.json'))).toEqual([]);
  });
  it.each(Object.entries(catalogs))('%s has no retired UI or removed wire-error keys', (path, catalog) => {
    const namespace = path.split('/').at(-1)!.replace('.json', '');
    for (const key of retired[namespace] ?? []) expect(at(catalog, key), key).toBeUndefined();
    if (namespace === 'errors') {
      const native = new Set<string>([...ERROR_CODES, 'generic', 'clientRequestTimeout']);
      expect(Object.keys(catalog).filter(key => !native.has(key))).toEqual([]);
    }
  });
});
