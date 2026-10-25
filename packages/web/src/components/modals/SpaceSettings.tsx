import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '../../i18n/formatters';
import { describeError } from '../../i18n/errors';
import { Modal } from '../ui/Modal';
import { useUIStore } from '../../stores/uiStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useAuthStore } from '../../stores/authStore';
import { getJoinRequestClient } from '../../utils/inviteJoinRequest';
import { resolveAssetUrl } from '../../utils/assetUrls';
import { Avatar } from '../ui/Avatar';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';
import { OverviewPanel, MembersPanel, RolesPanel, BansPanel, SoundboardPanel, AfkPanel, SettingsPanelSuspense } from './lazySettingsPanels';
import { useVisibilityOptions } from './spaceSettingsPanels/spaceOptions';
import type { SpaceVisibility, JoinRequest } from '@backspace/shared';

const DESCRIPTION_MAX_LENGTH = 200;

/** Core invitation access and metadata; independent of any discovery settings. */
export function AccessPanel({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation(['spaces', 'common']);
  const visibilityOptions = useVisibilityOptions();
  const space = useSpaceStore(s => s.spaces.find(space => space.id === spaceId));
  const updateSpace = useSpaceStore(s => s.updateSpace);
  const addToast = useUIStore(s => s.addToast);
  const [visibility, setVisibility] = useState<SpaceVisibility>(space?.visibility ?? 'private');
  const [description, setDescription] = useState(space?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    setVisibility(space?.visibility ?? 'private');
    setDescription(space?.description ?? '');
    setSaveError('');
  }, [space]);
  if (!space) return null;

  const hasChanges = visibility !== space.visibility || description !== (space.description ?? '');
  const handleSave = async () => {
    setSaving(true); setSaveError('');
    try {
      await updateSpace(spaceId, { visibility, description: description.trim() });
      addToast(t('common:states.settingsSaved'), 'success', 2000);
    } catch (err) { setSaveError(describeError(err)); }
    finally { setSaving(false); }
  };
  const handleReset = () => {
    setVisibility(space.visibility); setDescription(space.description ?? ''); setSaveError('');
  };

  return (
    <section className="space-y-5 mt-6">
      <h2 className="text-lg font-semibold text-txt-primary">{t('spaces:settings.access.title')}</h2>
      <div>
        <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider mb-1.5">{t('spaces:settings.access.visibility.label')}</div>
        <p className="text-xs text-txt-tertiary mb-2">{t('spaces:settings.access.visibility.hint')}</p>
        <div className="rounded-lg bg-white/[0.02] p-3.5 space-y-1.5">
          {visibilityOptions.map(opt => (
            <label key={opt.value} className={`flex items-start gap-3 p-2.5 rounded cursor-pointer transition-colors ${visibility === opt.value ? 'bg-interactive-selected' : 'hover:bg-interactive-hover'}`}>
              <input type="radio" name="visibility" value={opt.value} checked={visibility === opt.value}
                onChange={() => setVisibility(opt.value)} className="mt-0.5 accent-accent-primary" />
              <div>
                <div className="text-sm font-medium text-txt-primary">{opt.label}</div>
                <div className="text-xs text-txt-tertiary">{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider mb-1.5">{t('spaces:settings.access.description.label')}</div>
        <p className="text-xs text-txt-tertiary mb-2">{t('spaces:settings.access.description.hint')}</p>
        <div className="rounded-lg bg-white/[0.02] p-3.5">
          <textarea value={description} onChange={e => setDescription(e.target.value.slice(0, DESCRIPTION_MAX_LENGTH))}
            placeholder={t('spaces:settings.access.description.placeholder')} rows={3} className="input-standard w-full resize-none" />
          <div className="text-[11px] text-txt-tertiary text-right">
            {t('spaces:settings.access.description.counter', { length: description.length, max: DESCRIPTION_MAX_LENGTH })}
          </div>
        </div>
      </div>
      {saveError && <div className="p-2 bg-accent-rose/10 border border-accent-rose/30 rounded text-txt-danger text-sm">{saveError}</div>}
      {(visibility === 'request' || space.visibility === 'request') && <JoinRequestsSection spaceId={spaceId} origin={space._instanceOrigin} />}
      {hasChanges && (
        <div className="sticky bottom-0 z-10 pointer-events-none">
          <div className="flex justify-center pt-3 pb-1">
            <div className="glass-bubble rounded-full px-4 py-2 flex items-center gap-2 animate-slide-up pointer-events-auto">
              <button onClick={handleReset} className="px-3 py-1 text-sm text-txt-tertiary hover:text-txt-secondary transition-colors">{t('common:actions.reset')}</button>
              <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 bg-accent-primary hover:bg-accent-primary/80 text-white text-sm font-medium rounded-full transition-colors disabled:opacity-50">
                {saving ? t('common:states.saving') : t('common:actions.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function JoinRequestsSection({ spaceId, origin }: { spaceId: string; origin: string }) {
  const { t } = useTranslation(['spaces', 'common']);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const f = useFormatters();
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const token = useAuthStore(s => s.token);
  const generation = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const current = ++generation.current;
    setLoading(true); setRequests([]); setActionError('');
    getJoinRequestClient(origin).then(client => {
      if (cancelled || current !== generation.current || token !== useAuthStore.getState().token) return { requests: [] };
      return client.joinRequests.list(spaceId, 'pending');
    }).then(({ requests: reqs }) => {
      if (!cancelled && current === generation.current && token === useAuthStore.getState().token) {
        setRequests(reqs); setLoading(false);
      }
    }).catch((err: unknown) => {
      if (!cancelled && current === generation.current && token === useAuthStore.getState().token) {
        setLoading(false); setActionError(describeError(err));
      }
    });
    return () => { cancelled = true; generation.current = current + 1; };
  }, [spaceId, origin, token]);

  const handleDecide = async (requestId: string, action: 'accept' | 'decline') => {
    const current = generation.current;
    const isCurrent = () => current === generation.current && token === useAuthStore.getState().token;
    setActionError('');
    try {
      const client = await getJoinRequestClient(origin);
      if (!isCurrent()) return;
      await client.joinRequests.decide(spaceId, requestId, action);
      if (!isCurrent()) return;
      setRequests(prev => prev.filter(r => r.id !== requestId));
    } catch (err) { if (isCurrent()) setActionError(describeError(err)); }
  };

  return (
    <div className="pt-4 border-t border-border-soft">
      <div className="text-[11px] text-txt-tertiary font-semibold uppercase tracking-wider mb-2">{t('spaces:settings.access.requests.title')}</div>
      {actionError && <div className="mb-2 p-2 bg-accent-rose/10 border border-accent-rose/30 rounded text-txt-danger text-xs">{actionError}</div>}
      {loading ? (
        <div className="text-sm text-txt-tertiary">{t('common:states.loading')}</div>
      ) : requests.length === 0 ? (
        <div className="text-sm text-txt-tertiary">{t('spaces:settings.access.requests.empty')}</div>
      ) : (
        <div className="space-y-2 max-h-[240px] overflow-y-auto scrollbar-thin">
          {requests.map(req => {
            const user = req.user;
            const displayName = user?.displayName ?? user?.username ?? t('common:states.unknown');
            return (
              <div key={req.id} className="flex items-start gap-3 p-2.5 rounded bg-surface-base">
                <Avatar src={resolveAssetUrl(user?.avatar, origin)} name={displayName} size={32} userId={user?.homeUserId ?? user?.id} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-txt-primary truncate">{displayName}</span>
                    {user?.username && <span className="text-xs text-txt-tertiary">@{user.username}</span>}
                  </div>
                  {req.message && <p className="text-xs text-txt-secondary mt-0.5 line-clamp-2">{req.message}</p>}
                  <span className="text-[10px] text-txt-tertiary">{f.formatNumericDate(req.createdAt)}</span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => handleDecide(req.id, 'accept')} className="p-1.5 rounded text-status-online hover:bg-status-online/20 transition-colors" title={t('common:actions.accept')}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
                  </button>
                  <button onClick={() => handleDecide(req.id, 'decline')} className="p-1.5 rounded text-txt-danger hover:bg-accent-rose/20 transition-colors" title={t('common:actions.decline')}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type SpaceSettingsTab = 'overview' | 'members' | 'roles' | 'bans' | 'soundboard';
const SPACE_SETTINGS_TABS: readonly SpaceSettingsTab[] = ['overview', 'members', 'roles', 'bans', 'soundboard'];
function isSpaceSettingsTab(value: unknown): value is SpaceSettingsTab {
  return typeof value === 'string' && (SPACE_SETTINGS_TABS as readonly string[]).includes(value);
}

export function SpaceSettingsModal() {
  const { t } = useTranslation(['spaces', 'common']);
  const activeModal = useUIStore(s => s.activeModal);
  const modalData = useUIStore(s => s.modalData);
  const closeModal = useUIStore(s => s.closeModal);
  const isMobile = useUIStore(s => s.isMobile);
  const currentSpaceId = useSpaceStore(s => s.currentSpaceId);
  const spaces = useSpaceStore(s => s.spaces);
  const spacePermissions = useSpaceStore(s => s.spacePermissions);
  const [tab, setTab] = useState<SpaceSettingsTab>('overview');
  const [mobileView, setMobileView] = useState<'tabs' | 'content'>('tabs');
  const isOpen = activeModal === 'spaceSettings';
  const space = spaces.find(s => s.id === currentSpaceId);
  const mySpacePerms = currentSpaceId ? spacePermissions.get(currentSpaceId) : undefined;
  const canManageSpace = hasPermissionBit(mySpacePerms, PermissionBits.MANAGE_SPACE);
  const canManageRoles = hasPermissionBit(mySpacePerms, PermissionBits.MANAGE_ROLES);
  const canBanMembers = hasPermissionBit(mySpacePerms, PermissionBits.BAN_MEMBERS);
  const requestedTab = isOpen ? modalData.tab : undefined;

  useEffect(() => {
    if (!isOpen) return;
    const allowed: Record<SpaceSettingsTab, boolean> = {
      overview: true, soundboard: canManageSpace, members: true, roles: canManageRoles, bans: canBanMembers,
    };
    const deepLinked = isSpaceSettingsTab(requestedTab) && allowed[requestedTab];
    setTab(deepLinked ? requestedTab : 'overview');
    setMobileView(deepLinked ? 'content' : 'tabs');
    // Only the opening decides the tab, not later permission updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, requestedTab]);

  if (!space || !currentSpaceId) return null;
  const tabClass = (target: SpaceSettingsTab) =>
    `w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${tab === target ? 'bg-interactive-selected text-txt-primary font-medium' : 'text-txt-tertiary hover:text-txt-secondary hover:bg-interactive-hover'}`;
  const handleTabClick = (target: SpaceSettingsTab) => {
    setTab(target); if (isMobile) setMobileView('content');
  };
  const spaceCard = (
    <div className="glass-bubble rounded-lg p-3 flex items-center gap-3">
      <Avatar src={space.icon} name={space.name} size={36} userId={space.id} avatarColor={space.avatarColor} palette="space" />
      <div className="min-w-0"><div className="text-sm font-medium text-txt-primary truncate">{space.name}</div></div>
    </div>
  );
  const navigation = (
    <div className="glass-bubble rounded-lg p-2 flex-1 flex flex-col">
      <div className="text-[10px] font-semibold text-txt-tertiary uppercase tracking-wider px-3 py-1">{t('spaces:settings.nav.general')}</div>
      <button onClick={() => handleTabClick('overview')} className={tabClass('overview')}>{t('spaces:settings.nav.tabs.overview')}</button>
      {canManageSpace && <button onClick={() => handleTabClick('soundboard')} className={tabClass('soundboard')}>{t('spaces:soundboardTab')}</button>}
      <div className="border-t border-white/[0.04] my-2 mx-2" />
      <div className="text-[10px] font-semibold text-txt-tertiary uppercase tracking-wider px-3 py-1">{t('spaces:settings.nav.management')}</div>
      <button onClick={() => handleTabClick('members')} className={tabClass('members')}>{t('common:labels.members')}</button>
      {canManageRoles && <button onClick={() => handleTabClick('roles')} className={tabClass('roles')}>{t('spaces:settings.nav.tabs.roles')}</button>}
      {canBanMembers && <button onClick={() => handleTabClick('bans')} className={tabClass('bans')}>{t('spaces:settings.nav.tabs.bans')}</button>}
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={closeModal} size="settings" mobileStyle="fullscreen">
      <div className="flex h-full">
        <div className="hidden desktop:flex w-52 flex-shrink-0 flex-col p-4 gap-3">{spaceCard}{navigation}</div>
        {isMobile && mobileView === 'tabs' && <div className="flex-1 overflow-y-auto p-4 space-y-3">{spaceCard}{navigation}</div>}
        {(!isMobile || mobileView === 'content') && (
          <div className="flex-1 min-w-0 overflow-y-auto scrollbar-thin py-6">
            <div className="px-6 max-w-[640px] mx-auto">
              {isMobile && (
                <button onClick={() => setMobileView('tabs')} className="flex items-center gap-1.5 text-txt-tertiary hover:text-txt-secondary mb-4 text-sm" aria-label={t('spaces:settings.backAria')}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" /></svg>
                  {t('spaces:settings.title')}
                </button>
              )}
              <SettingsPanelSuspense key={tab}>
                {tab === 'overview' && <OverviewPanel spaceId={currentSpaceId} />}
                {tab === 'overview' && canManageSpace && <AccessPanel key={currentSpaceId} spaceId={currentSpaceId} />}
                {tab === 'overview' && canManageSpace && <AfkPanel spaceId={currentSpaceId} />}
                {tab === 'soundboard' && canManageSpace && <SoundboardPanel spaceId={currentSpaceId} />}
                {tab === 'members' && <MembersPanel spaceId={currentSpaceId} />}
                {tab === 'roles' && canManageRoles && <RolesPanel spaceId={currentSpaceId} />}
                {tab === 'bans' && canBanMembers && <BansPanel spaceId={currentSpaceId} />}
              </SettingsPanelSuspense>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
