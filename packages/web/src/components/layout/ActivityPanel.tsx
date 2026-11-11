import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSocialStore } from '../../stores/socialStore';
import { useUIStore } from '../../stores/uiStore';
import { RightPanelResizeHandle } from './RightPanelResizeHandle';
import { useActivityStore, activitiesFor } from '../../stores/activityStore';
import { Avatar } from '../ui/Avatar';
import { ActivityCard, hasRichActivity, getActivityAccentClass } from '../ui/ActivityCard';
import type { Activity, Friend } from '@veyvox/shared';
import { getPrimaryActivity } from '@veyvox/shared/src/activities.js';
import { userDisplayName } from '../../utils/identity';
import { useCanonicalUserView } from '../../utils/userViewLookup';

function ActivityFriendRow({
  friend,
  isOffline,
  activities,
  isRichActivity,
  accentClass,
  onClickFriend,
}: {
  friend: Friend;
  isOffline: boolean;
  activities: Activity[];
  isRichActivity: boolean;
  accentClass: string;
  onClickFriend: (e: React.MouseEvent, friend: Friend) => void;
}) {
  const canonical = useCanonicalUserView(friend);
  const friendDisplayName = userDisplayName(canonical);

  const rowClass = isRichActivity
    ? `flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] mb-1 cursor-pointer transition-all duration-200 ease-out glass-pill border-l-2 ${accentClass}`
    : 'flex items-center gap-2.5 px-2 py-1.5 rounded-[4px] border-l-2 border-transparent hover:bg-interactive-hover cursor-pointer group transition-all duration-200 ease-out';

  return (
    <div
      onClick={(e) => onClickFriend(e, friend)}
      className={rowClass}
    >
      <Avatar
        src={canonical.avatar}
        name={friendDisplayName}
        size={32}
        status={isOffline ? 'offline' : canonical.status}
        className={isOffline ? 'opacity-60' : undefined}
        userId={canonical.id}
        avatarColor={canonical.avatarColor}
      />
      <div className="flex-1 min-w-0">
        <span className={`text-[13.5px] leading-[1.2] font-medium truncate ${isOffline ? 'text-txt-tertiary' : 'text-txt-primary'}`}>{friendDisplayName}</span>
        {!isOffline && (
          <ActivityCard
            activities={activities}
            fallbackCustomStatus={canonical.customStatus}
          />
        )}
      </div>
    </div>
  );
}

export function ActivityPanel() {
  const { t } = useTranslation(['social', 'common']);
  const friends = useSocialStore((s) => s.friends);
  const loadFriends = useSocialStore((s) => s.loadFriends);
  const memberListOpen = useUIStore((s) => s.memberListOpen);
  const rightPanelWidth = useUIStore((s) => s.rightPanelWidth);
  const openUserProfile = useUIStore((s) => s.openUserProfile);
  const userActivities = useActivityStore((s) => s.userActivities);

  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

  const { activeFriends, onlineFriends, offlineFriends } = useMemo(() => {
    const active: Friend[] = [];
    const online: Friend[] = [];
    const offline: Friend[] = [];

    for (const f of friends) {
      if (f.status === 'offline') {
        offline.push(f);
        continue;
      }
      const activities = activitiesFor(userActivities, f.id);
      const primary = getPrimaryActivity(activities);
      // Active = has a non-custom activity (playing, listening, watching, streaming)
      if (primary && primary.type !== 'custom') {
        active.push(f);
      } else {
        online.push(f);
      }
    }

    return { activeFriends: active, onlineFriends: online, offlineFriends: offline };
  }, [friends, userActivities]);

  if (!memberListOpen) return null;

  const handleFriendClick = (e: React.MouseEvent, friend: Friend) => {
    e.stopPropagation();
    openUserProfile(
      { ...friend, isAdmin: false },
      e.currentTarget.getBoundingClientRect(),
      'left',
    );
  };

  const renderFriend = (friend: Friend, isOffline = false) => {
    const activities = activitiesFor(userActivities, friend.id);
    const isRichActivity = !isOffline && hasRichActivity(activities);
    const primary = getPrimaryActivity(activities);
    const accentClass = primary ? getActivityAccentClass(primary.type) : '';
    return (
      <ActivityFriendRow
        key={friend.id}
        friend={friend}
        isOffline={isOffline}
        activities={activities}
        isRichActivity={isRichActivity}
        accentClass={accentClass}
        onClickFriend={handleFriendClick}
      />
    );
  };

  return (
    <div
      className="relative bg-surface-channel flex-shrink-0 hidden desktop:block"
      style={{ width: rightPanelWidth }}
    >
      <RightPanelResizeHandle label={t('social:activity.resizeHandle')} />
      <div className="h-full overflow-y-auto select-none no-scrollbar border-l border-border-hard">
      <div className="p-3">
        <h3 className="text-[20px] font-bold text-txt-primary mb-4 px-2">{t('social:activity.title')}</h3>

        {activeFriends.length === 0 && onlineFriends.length === 0 && offlineFriends.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-[16px] font-bold text-txt-primary mb-1">{t('social:activity.quietTitle')}</div>
            <div className="text-[14px] text-txt-tertiary max-w-[200px] mx-auto">
              {t('social:activity.quietDescription')}
            </div>
          </div>
        ) : (
          <>
            {activeFriends.length > 0 && (
              <div className="mb-4">
                {activeFriends.map(f => renderFriend(f))}
              </div>
            )}
            {onlineFriends.length > 0 && (
              <div className="mb-4">
                <h3 className="text-[10.5px] font-bold text-txt-tertiary uppercase tracking-[0.06em] px-2 mb-1">
                  {t('social:activity.online', { n: onlineFriends.length })}
                </h3>
                {onlineFriends.map(f => renderFriend(f))}
              </div>
            )}
            {offlineFriends.length > 0 && (
              <div>
                <h3 className="text-[10.5px] font-bold text-txt-tertiary uppercase tracking-[0.06em] px-2 mb-1">
                  {t('social:activity.offline', { n: offlineFriends.length })}
                </h3>
                {offlineFriends.map(f => renderFriend(f, true))}
              </div>
            )}
          </>
        )}
      </div>
      </div>
    </div>
  );
}
