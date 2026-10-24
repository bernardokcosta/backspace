import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { useFloatingPosition } from '../../hooks/useFloatingPosition';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { getChannelOrigin } from '../../stores/spaceStore';
import { Avatar } from '../ui/Avatar';
import { formatters } from '../../i18n/formatters';
import type { PinWithMessage } from '@backspace/shared';

/** Shared empty board: a `?? []` inside the selector below returns a new array
 * on every store change and re-renders (then loops) forever. */
const EMPTY_PINS: PinWithMessage[] = [];

interface PinnedMessagesPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  channelId: string;
  canManageMessages: boolean;
  onJumpToMessage: (messageId: string) => void;
}

function PinRow({ pin, canUnpin, onJump, onUnpin }: {
  pin: PinWithMessage;
  canUnpin: boolean;
  onJump: (messageId: string) => void;
  onUnpin: (messageId: string) => void;
}) {
  const { t } = useTranslation(['chat']);
  const msg = pin.message;
  return (
    <div className="w-full px-3 py-2.5 hover:bg-interactive-hover transition-colors flex items-start gap-2.5 group/pin">
      <button
        onClick={() => onJump(pin.messageId)}
        className="flex-1 min-w-0 text-left flex items-start gap-2.5"
        title={t('chat:pins.jump')}
      >
        <div className="flex-shrink-0 mt-0.5">
          <Avatar src={null} name={msg?.user.username ?? '?'} size={28} user={msg?.user} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[13px] font-semibold text-txt-primary truncate">
              {msg?.user.displayName ?? msg?.user.username ?? t('chat:pins.deletedMessage')}
            </span>
            {msg && (
              <span className="text-[10px] text-txt-tertiary flex-shrink-0">
                {formatters.formatDateTime(msg.createdAt)}
              </span>
            )}
          </div>
          <div className="text-[13px] text-txt-secondary leading-[1.4] line-clamp-2 mt-0.5">
            {msg?.content || (msg?.attachments.length ? t('chat:pins.attachmentOnly') : t('chat:pins.deletedMessage'))}
          </div>
        </div>
      </button>
      {canUnpin && (
        <button
          onClick={() => onUnpin(pin.messageId)}
          className="flex-shrink-0 mt-1 px-2 h-7 text-[12px] text-txt-tertiary hover:text-txt-danger hover:bg-interactive-hover rounded transition-colors opacity-0 group-hover/pin:opacity-100 focus-visible:opacity-100"
          title={t('chat:menu.unpinMessage')}
        >
          {t('chat:pins.unpin')}
        </button>
      )}
    </div>
  );
}

export function PinnedMessagesPopover({ open, onClose, anchorRef, channelId, canManageMessages, onJumpToMessage }: PinnedMessagesPopoverProps) {
  const { t } = useTranslation(['chat']);
  const floatingRef = useRef<HTMLDivElement>(null);
  const pins = useChatStore((s) => s.pinnedByChannel.get(channelId)) ?? EMPTY_PINS;
  const loadPins = useChatStore((s) => s.loadPins);
  const unpinMessage = useChatStore((s) => s.unpinMessage);
  // `pinnedById` is the channel's instance row id: compare with the user's
  // row on that origin, not the local session id (they differ over federation).
  const origin = getChannelOrigin(channelId);
  const homeId = useAuthStore((s) => s.user?.id);
  const rowIds = useAuthStore((s) => s.myRowIds);
  const myId = origin ? (rowIds.get(origin) ?? homeId) : homeId;

  const { style } = useFloatingPosition(anchorRef, floatingRef, { placement: 'bottom', offset: 8, enabled: open });

  useEffect(() => {
    if (open) void loadPins(channelId);
  }, [open, channelId, loadPins]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPointer = (e: PointerEvent) => {
      if (floatingRef.current && !floatingRef.current.contains(e.target as Node) && !(anchorRef.current?.contains(e.target as Node))) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div ref={floatingRef} style={style} role="dialog" aria-label={t('chat:pins.title')} className="glass z-50 w-[380px] max-w-full max-h-[500px] overflow-y-auto rounded-xl py-1.5">
      <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-txt-tertiary">
        {t('chat:pins.title')} · {pins.length}
      </div>
      {pins.length === 0 && (
        <div className="px-3 py-6 text-sm text-txt-tertiary text-center">{t('chat:pins.empty')}</div>
      )}
      {pins.map((pin) => (
        <PinRow
          key={pin.messageId}
          pin={pin}
          canUnpin={canManageMessages || (pin.pinnedById !== null && pin.pinnedById === myId)}
          onJump={(id) => { onJumpToMessage(id); onClose(); }}
          onUnpin={(id) => void unpinMessage(id, channelId)}
        />
      ))}
    </div>,
    document.body,
  );
}
