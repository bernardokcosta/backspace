import { getFriendshipStatus, type FriendshipStatus } from '../../utils/friendshipStatus';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '../../i18n/formatters';
import { describeError } from '../../i18n/errors';
import { useNavigate } from 'react-router-dom';
import type { User, Activity } from '@veyvox/shared';
import { Avatar } from '../ui/Avatar';
import { Username } from '../ui/Username';
import { BotBadge } from '../ui/BotBadge';
import { ProfileBio } from '../ui/ProfileBio';
import { useUIStore, type ProfileMemberContext } from '../../stores/uiStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { api } from '../../api/client';
import { useSocialStore } from '../../stores/socialStore';
import { useAuthStore } from '../../stores/authStore';
import { getAvatarGradient, getSpaceGradient, adjustColor, mutedGradient } from '../../utils/gradients';
import { userDisplayName } from '../../utils/identity';
import { openDirectMessage } from '../../utils/openDirectMessage';
import { uploadUrl } from '../../utils/assetUrls';
import { presenceLabel } from '../../i18n/presence';
import { replaceEmojiShortcodes, useEmojiShortcodeNames } from '../../utils/emojiShortcodes';
import { getProfileMember, useProfileMemberRoles } from '../../hooks/useProfileMember';
import { useShownStatus } from '../../hooks/useShownStatus';
import { ProfileRoles } from '../ui/ProfileRoles';
import { ProfileSpaceNickname } from '../ui/ProfileSpaceNickname';
import { useActivityStore, activitiesFor } from '../../stores/activityStore';
import { ProfileActivities } from '../ui/ProfileActivities';

const EMPTY_ACTIVITIES: Activity[] = [];

type Tab = 'about' | 'friends' | 'spaces';

export function UserProfileModal() {
  const revision = useAuthStore(s => s.sessionRevision);
  const active = useUIStore(s => s.activeModal === 'userProfile');
  const userId = useUIStore(s => s.modalData.userId as string | undefined);
  return <ProfileContent key={JSON.stringify([revision, active, userId])} revision={revision} />;
}

function ProfileContent({ revision }: { revision: number }) {
  useEmojiShortcodeNames();
  const { t } = useTranslation(['social', 'common']);
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData);
  const closeModal = useUIStore((s) => s.closeModal);
  const addToast = useUIStore((s) => s.addToast);
  const navigate = useNavigate();
  const f = useFormatters();
  const friends = useSocialStore((s) => s.friends);
  const requests = useSocialStore((s) => s.requests);
  const sendFriendRequest = useSocialStore((s) => s.sendFriendRequest);
  const removeFriend = useSocialStore((s) => s.removeFriend);
  const updateFriendRequest = useSocialStore((s) => s.updateFriendRequest);
  const cancelFriendRequest = useSocialStore((s) => s.cancelFriendRequest);
  const selfId = useAuthStore(s => s.user?.id);

  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('about');
  const [mutualFriends, setMutualFriends] = useState<User[]>([]);
  const [mutualSpaces, setMutualSpaces] = useState<Awaited<ReturnType<typeof api.users.getMutuals>>['mutualSpaces']>([]);
  const [loadingMutuals, setLoadingMutuals] = useState(false);
  const [friendActionLoading, setFriendActionLoading] = useState(false);

  const isOpen = activeModal === 'userProfile';
  const userId = modalData?.userId as string | undefined;
  const passedUser = modalData?.user as User | undefined;
  const memberContext = (modalData?.member as ProfileMemberContext | null | undefined) ?? null;
  const memberSpaceId = memberContext?.spaceId;
  const memberUserId = memberContext?.userId;
  const roles = useProfileMemberRoles(memberContext);

  const friendship: FriendshipStatus = user
    ? getFriendshipStatus({ viewedUser: user, selfUserId: selfId, friends, requests })
    : { state: 'none' };

  const isYou = friendship.state === 'self';
  const activities = useActivityStore((s) =>
    user
      ? isYou && s.myActivities
        ? s.myActivities
        : activitiesFor(s.userActivities, user.id)
      : EMPTY_ACTIVITIES,
  );

  useEffect(() => {
    let alive = true;
    const current = () => alive && revision === useAuthStore.getState().sessionRevision;
    if (isOpen && userId) {
      setActiveTab('about');
      // Mobile can open by IDs only; reuse an exact native roster match first.
      const fromSpace = !passedUser && memberSpaceId && memberUserId
        ? getProfileMember({ spaceId: memberSpaceId, userId: memberUserId })
        : undefined;
      const knownUser = passedUser?.id === userId ? passedUser : fromSpace?.user.id === userId ? fromSpace.user : null;
      setUser(knownUser);
      if (!knownUser) {
        void api.users.get(userId).then(row => {
          if (!current()) return;
          setUser(row); useSpaceStore.getState().upsertUserView(row);
        }).catch(() => {});
      }
      setMutualFriends([]); setMutualSpaces([]); setLoadingMutuals(true);
      void api.users.getMutuals(userId).then(data => {
        if (!current()) return;
        setMutualFriends(data.mutualFriends); setMutualSpaces(data.mutualSpaces);
      }).catch(() => {}).finally(() => { if (current()) setLoadingMutuals(false); });
    }
    return () => { alive = false; };
  }, [isOpen, userId, passedUser, memberSpaceId, memberUserId, revision]);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, closeModal]);

  const shownStatus = useShownStatus(user, user?.status);

  if (!isOpen || !user) return null;

  const displayName = userDisplayName(user);
  const current = () => {
    const ui = useUIStore.getState();
    return revision === useAuthStore.getState().sessionRevision && ui.activeModal === 'userProfile' && ui.modalData.userId === userId;
  };

  const bannerSrc = uploadUrl(user.banner);
  const bannerFallback = user.accentColor
    ? mutedGradient(user.accentColor, adjustColor(user.accentColor, -40))
    : (() => {
        const g = getAvatarGradient(user.id, displayName, user.avatarColor);
        return mutedGradient(g.from, g.to);
      })();

  const handleSendMessage = async () => {
    try {
      const rowId = await openDirectMessage(user.id);
      if (!current()) return;
      useUIStore.getState().setShowDms(true);
      closeModal();
      navigate(`/channels/@me/${rowId}`);
    } catch (err) {
      if (current()) addToast(t('social:sendMessage.failed', { reason: describeError(err) }), 'warning');
    }
  };

  const handleAddFriend = async () => {
    setFriendActionLoading(true);
    try {
      await sendFriendRequest({ username: user.username });
    } catch (err) {
      if (current()) addToast(describeError(err), 'warning');
    } finally {
      if (current()) setFriendActionLoading(false);
    }
  };

  const handleRemoveFriend = async () => {
    if (friendship.state !== 'friends') return;
    setFriendActionLoading(true);
    try { await removeFriend(friendship.friend.id); }
    catch (err) { if (current()) addToast(describeError(err), 'warning'); }
    finally { if (current()) setFriendActionLoading(false); }
  };

  const handleCancelRequest = async () => {
    if (friendship.state !== 'outbound_pending') return;
    setFriendActionLoading(true);
    try { await cancelFriendRequest(friendship.request.id); }
    catch (err) { if (current()) addToast(describeError(err), 'warning'); }
    finally { if (current()) setFriendActionLoading(false); }
  };

  const handleAcceptRequest = async () => {
    if (friendship.state !== 'inbound_pending') return;
    setFriendActionLoading(true);
    try { await updateFriendRequest(friendship.request.id, 'accepted'); }
    catch (err) { if (current()) addToast(describeError(err), 'warning'); }
    finally { if (current()) setFriendActionLoading(false); }
  };

  const handleDeclineRequest = async () => {
    if (friendship.state !== 'inbound_pending') return;
    setFriendActionLoading(true);
    try { await updateFriendRequest(friendship.request.id, 'declined'); }
    catch (err) { if (current()) addToast(describeError(err), 'warning'); }
    finally { if (current()) setFriendActionLoading(false); }
  };

  const handleViewFriend = (friend: User) => {
    useUIStore.getState().openModal('userProfile', { userId: friend.id, user: friend });
  };

  const handleGoToSpace = (spaceId: string) => {
    closeModal();
    navigate(`/channels/${spaceId}`);
  };

  // A bot takes no friends, so it has no mutual friends to list.
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'about', label: t('social:profile.tabs.about') },
    ...(user?.isBot ? [] : [{ key: 'friends' as const, label: t('social:profile.tabs.mutualFriends'), count: mutualFriends.length }]),
    { key: 'spaces', label: t('social:profile.tabs.mutualSpaces'), count: mutualSpaces.length },
  ];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-black/50" onClick={closeModal} />
      <div className="relative max-w-lg w-full mx-4 max-h-[calc(calc(100*var(--app-vh))-2rem)] flex flex-col glass-modal rounded-lg animate-slide-up overflow-hidden">
        {/* Banner */}
        <div
          className="h-[100px] flex-shrink-0 relative"
          style={bannerSrc
            ? { backgroundImage: `url(${bannerSrc})`, backgroundSize: 'cover', backgroundPosition: 'center' }
            : { background: bannerFallback }
          }
        >
          {/* Close button */}
          <button
            onClick={closeModal}
            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
            </svg>
          </button>
        </div>

        {/* Header (avatar + name) */}
        <div className="px-5 flex-shrink-0 relative">
          <Avatar
            src={user.avatar}
            name={displayName}
            size={96}
            status={shownStatus}
            userId={user.id}
            user={user}
            ring={{ width: 4, color: 'rgba(20,20,26,0.82)' }}
            className="mt-[-52px] mb-2"
          />

          <div className="mb-3">
            <ProfileSpaceNickname member={memberContext} />
            <div className="flex items-center gap-2">
              <span className="text-[20px] font-bold leading-tight">{displayName}</span>
              {user.isBot && <BotBadge />}
            </div>
            <div className="text-[14px] text-txt-tertiary mt-0.5">
              <Username username={user.username} showAt className="text-[14px] text-txt-tertiary" />
            </div>
            {user.customStatus && (
              <div className="text-[13px] text-txt-secondary italic mt-1">
                {replaceEmojiShortcodes(user.customStatus)}
              </div>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div className="px-5 flex-shrink-0 border-b border-white/[0.06]">
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-2 text-[13px] font-medium rounded-t-lg transition-colors relative ${
                  activeTab === tab.key
                    ? 'text-txt-primary'
                    : 'text-txt-tertiary hover:text-txt-secondary'
                }`}
              >
                {tab.label}
                {tab.count !== undefined && !loadingMutuals && (
                  <span className="ml-1 text-[11px] text-txt-tertiary">({tab.count})</span>
                )}
                {activeTab === tab.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent-primary rounded-full" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 min-h-[200px]">
          {activeTab === 'about' && (
            <div className="space-y-4">
              <ProfileActivities activities={activities} skipCustom={!!user.customStatus} />

              {/* Bio */}
              {user.bio && (
                <div>
                  <span className="text-[11px] uppercase tracking-wide font-semibold text-txt-tertiary">
                    {t('social:profile.aboutMe')}
                  </span>
                  <ProfileBio bio={user.bio} />
                </div>
              )}

              <ProfileRoles roles={roles} />

              {/* Member Since */}
              <div>
                <span className="text-[11px] uppercase tracking-wide font-semibold text-txt-tertiary">
                  {t('social:profile.memberSince')}
                </span>
                <div className="text-[13px] text-txt-secondary mt-1">
                  {f.formatLongDate(user.createdAt)}
                </div>
              </div>

            </div>
          )}

          {activeTab === 'friends' && (
            <div>
              {loadingMutuals ? (
                <div className="flex items-center justify-center py-8">
                  <svg className="animate-spin w-5 h-5 text-txt-tertiary" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              ) : mutualFriends.length === 0 ? (
                <div className="text-center py-8 text-txt-tertiary text-[13px]">
                  {t('social:mutuals.noFriends')}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {mutualFriends.map((friend) => {
                    const fname = userDisplayName(friend);
                    return (
                      <button
                        key={friend.id}
                        onClick={() => handleViewFriend(friend)}
                        className="flex items-center gap-2.5 p-2.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.04] transition-colors text-left"
                      >
                        <Avatar
                          src={friend.avatar}
                          name={fname}
                          size={40}
                          status={friend.status}
                          userId={friend.id}
                          avatarColor={friend.avatarColor}
                        />
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-txt-primary truncate">
                            {fname}
                          </div>
                          <div className="text-[11px] text-txt-tertiary">
                            {presenceLabel(t, friend.status)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'spaces' && (
            <div>
              {loadingMutuals ? (
                <div className="flex items-center justify-center py-8">
                  <svg className="animate-spin w-5 h-5 text-txt-tertiary" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              ) : mutualSpaces.length === 0 ? (
                <div className="text-center py-8 text-txt-tertiary text-[13px]">
                  {t('social:mutuals.noSpaces')}
                </div>
              ) : (
                <div className="space-y-1">
                  {mutualSpaces.map((space) => {
                    return (
                    <button
                      key={space.id}
                      onClick={() => handleGoToSpace(space.id)}
                      className="flex items-center gap-3 w-full p-2.5 rounded-lg hover:bg-white/[0.06] transition-colors text-left"
                    >
                      <div className="relative shrink-0">
                        {space.icon ? (
                          <img
                            src={uploadUrl(space.icon) ?? undefined}
                            alt={space.name}
                            className="w-8 h-8 rounded-lg object-cover"
                          />
                        ) : (
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-semibold text-white"
                            style={{ background: getSpaceGradient(space.id, space.name, space.avatarColor).gradient }}
                          >
                            {space.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex flex-col">
                        <span className="text-[13px] font-medium text-txt-primary truncate">
                          {space.name}
                        </span>
                      </div>
                    </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action buttons. Your own profile offers none: nobody messages or
            befriends themselves. */}
        {friendship.state !== 'self' && (
          <div className="flex-shrink-0 px-5 py-3 border-t border-white/[0.06] flex gap-2">
            <button
              onClick={handleSendMessage}
              className="flex-1 py-2 rounded-lg text-[13px] font-medium text-white bg-accent-primary hover:bg-accent-primary/80 transition-colors"
            >
              {t('social:profile.sendMessage')}
            </button>

            {!user.isBot && friendship.state === 'none' && (
              <button onClick={handleAddFriend} disabled={friendActionLoading}
                className="flex-1 py-2 rounded-lg text-[13px] font-medium text-txt-primary border border-white/[0.08] bg-white/[0.06] hover:bg-white/[0.10] transition-colors disabled:opacity-50">
                {friendActionLoading ? '...' : t('social:profile.addFriend')}
              </button>
            )}

            {!user.isBot && friendship.state === 'outbound_pending' && (
              <button onClick={handleCancelRequest} disabled={friendActionLoading}
                className="flex-1 py-2 rounded-lg text-[13px] font-medium text-amber-400 border border-amber-400/30 hover:bg-amber-400/10 transition-colors disabled:opacity-50">
                {friendActionLoading ? '...' : t('social:request.cancel')}
              </button>
            )}

            {!user.isBot && friendship.state === 'inbound_pending' && (
              <>
                <button onClick={handleAcceptRequest} disabled={friendActionLoading}
                  className="flex-1 py-2 rounded-lg text-[13px] font-medium text-white bg-accent-primary hover:bg-accent-primary/80 transition-colors disabled:opacity-50">
                  {friendActionLoading ? '...' : t('common:actions.accept')}
                </button>
                <button onClick={handleDeclineRequest} disabled={friendActionLoading}
                  className="py-2 px-3 rounded-lg text-[13px] font-medium text-txt-tertiary border border-white/[0.06] hover:bg-white/[0.06] transition-colors disabled:opacity-50">
                  {friendActionLoading ? '...' : t('social:request.ignore')}
                </button>
              </>
            )}

            {!user.isBot && friendship.state === 'friends' && (
              <button onClick={handleRemoveFriend} disabled={friendActionLoading}
                className="flex-1 py-2 rounded-lg text-[13px] font-medium text-txt-danger border border-txt-danger/30 hover:bg-txt-danger/10 transition-colors disabled:opacity-50">
                {friendActionLoading ? '...' : t('social:friend.remove')}
              </button>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
