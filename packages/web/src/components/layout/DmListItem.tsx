import { useTranslation } from 'react-i18next';
import type { DmChannel, User } from '@veyvox/shared';
import { Avatar } from '../ui/Avatar';
import { AvatarStack } from '../ui/AvatarStack';
import { userDisplayName } from '../../utils/identity';
import { useAuthStore } from '../../stores/authStore';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import { formatDmTimestamp, formatDmSidebarPreview, formatDmHeaderName } from '../../utils/dmFormatters';
import { BotBadge } from '../ui/BotBadge';

/** The native other party of a 1-on-1 DM. */
export interface DmInviteCounterpart {
  user: User;
}

interface DmListItemProps {
  dm: DmChannel;
  isActive: boolean;
  isUnread: boolean;
  user: User;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onLeave: (id: string) => void;
  onContextMenu?: (e: React.MouseEvent, dm: DmChannel, counterpart: DmInviteCounterpart | null) => void;
}

export function DmListItem({ dm, isActive, isUnread, user, onSelect, onClose, onLeave, onContextMenu }: DmListItemProps) {
  const { t } = useTranslation('dm');
  const selfId = useAuthStore(s => s.user?.id ?? null);
  const otherMembers = dm.members.filter(m => m.id !== selfId);
  const isGroup = !!dm.ownerId;

  // Route the 1-on-1 partner through the canonical view cache. Group member
  // avatars are handled per-slot in DmGroupAvatarSlot (hook-in-loop safety).
  const rawFirstOther = isGroup ? null : (otherMembers[0] ?? null);
  const firstOtherCanonical = useCanonicalUserView(rawFirstOther ?? user);
  const firstOther = rawFirstOther ? firstOtherCanonical : null;
  if (otherMembers.length === 0 && !isGroup) return null;

  // Groups → `formatDmHeaderName` (honors `dm.name`, falls back to joined
  // names — same path used by the chat header, welcome hero, and mobile).
  // 1-on-1 uses the latest native profile name.
  const displayName = isGroup
    ? formatDmHeaderName(dm, selfId)
    : firstOther ? userDisplayName(firstOther) : '';

  const handleClick = () => onSelect(dm.id);
  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isGroup) {
      onLeave(dm.id);
    } else {
      onClose(dm.id);
    }
  };
  const handleContextMenu = onContextMenu
    ? (e: React.MouseEvent) => onContextMenu(e, dm, isGroup || !firstOther ? null : { user: firstOther })
    : undefined;

  // ── State-driven classes ──────────────────────────────────────────────
  // Container: 6px radius (up from 4px), 44px height (up from 42px)
  const containerClass = `relative flex items-center gap-3 px-2 h-[44px] rounded-[6px] cursor-pointer transition-colors group ${
    isActive
      ? 'bg-interactive-selected text-white'
      : isUnread
        ? 'text-white hover:bg-interactive-hover'
        : 'text-txt-tertiary hover:bg-interactive-hover hover:text-txt-secondary'
  }`;

  // Name: font-semibold for unread (deliberately NOT font-bold — design decision)
  const nameClass = `text-[15px] truncate leading-tight ${
    isActive ? 'text-white font-medium'
      : isUnread ? 'text-white font-semibold'
      : 'text-txt-tertiary group-hover:text-txt-secondary font-medium'
  }`;

  // Timestamp: brightens on hover and lifts for unread/selected
  const timestampClass = `text-[11px] ml-auto flex-shrink-0 ${
    isActive || isUnread
      ? 'text-txt-secondary'
      : 'text-txt-tertiary group-hover:text-txt-secondary'
  }`;

  // Preview: brightens on hover and lifts for unread/selected
  const previewClass = `text-[12px] truncate leading-tight mt-0.5 ${
    isActive || isUnread
      ? 'text-txt-secondary'
      : 'text-txt-tertiary group-hover:text-txt-secondary'
  }`;

  // Close button: always visible when selected, hover-reveal otherwise
  const closeClass = `${
    isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
  } text-txt-tertiary hover:text-txt-primary transition-opacity flex-shrink-0 ml-1`;

  // ── Preview text ──────────────────────────────────────────────────────
  // formatDmSidebarPreview handles user/system messages and applies the
  // sender prefix for group user-messages. We only need to provide the
  // empty-group fallback ourselves.
  const preview = formatDmSidebarPreview(dm, selfId);
  const previewText = preview ?? (isGroup ? `${dm.members.length} Members` : null);

  const itemJsx = (
    <div
      onClick={handleClick}
      className={containerClass}
    >
      {/* Selected accent bar */}
      {isActive && (
        <div
          className="absolute -left-[2px] top-1/2 -translate-y-1/2 w-[3px] bg-white rounded-r-full"
          style={{ height: '55%', opacity: 0.7 }}
        />
      )}

      {/* Unread indicator */}
      {isUnread && (
        <div className="absolute -left-1 w-1 h-2 bg-white rounded-r-full" />
      )}

      {/* Avatar */}
      {isGroup ? (
        <AvatarStack members={otherMembers} size={32} border="channel" iconUrl={dm.icon} />
      ) : (
        <Avatar src={firstOther?.avatar} name={displayName} size={32} status={firstOther?.status} userId={firstOther?.id} user={firstOther ?? undefined} />
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={nameClass}>
              {displayName}
            </span>
            {!isGroup && firstOther?.isBot && <BotBadge />}
          </div>
          {dm.lastMessage && (
            <span className={timestampClass}>
              {formatDmTimestamp(dm.lastMessage.createdAt)}
            </span>
          )}
        </div>
        {previewText && (
          <div className={previewClass}>
            {previewText}
          </div>
        )}
      </div>

      {/* Close / Leave button */}
      <button
        onClick={handleClose}
        className={closeClass}
        title={isGroup ? t('list.leaveGroup') : t('list.close')}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
        </svg>
      </button>
    </div>
  );

  // Right-click: group DMs can be left, 1-on-1s can invite the other person.
  if (handleContextMenu) {
    return <div onContextMenu={handleContextMenu}>{itemJsx}</div>;
  }

  return itemJsx;
}
