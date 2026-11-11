import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Avatar } from '../ui/Avatar';
import { useUIStore } from '../../stores/uiStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useAuthStore } from '../../stores/authStore';
import { useSocialStore } from '../../stores/socialStore';
import { api } from '../../api/client';
import { userDisplayName } from '../../utils/identity';
import { uploadUrl } from '../../utils/assetUrls';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import type { BotSummary, Friend } from '@veyvox/shared';

function AddDmFriendRow({
  friend,
  isInDm,
  isSelected,
  atCapacity,
  isAdding,
  onToggle,
}: {
  friend: Friend;
  isInDm: boolean;
  isSelected: boolean;
  atCapacity: boolean;
  isAdding: boolean;
  onToggle: (key: string) => void;
}) {
  const { t } = useTranslation(['dm', 'common']);
  const canonical = useCanonicalUserView(friend);
  const friendDisplayName = userDisplayName(canonical);
  return (
    <button
      onClick={() => onToggle(friend.id)}
      disabled={isInDm || isAdding || atCapacity}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-[4px] transition-colors text-left ${
        isInDm
          ? 'opacity-40 cursor-not-allowed'
          : isSelected
            ? 'bg-accent-mint/[0.08]'
            : 'hover:bg-interactive-hover'
      } ${atCapacity && !isInDm ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <Avatar
        src={canonical.avatar}
        name={friendDisplayName}
        size={30}
        status={canonical.status}
        userId={canonical.id}
        avatarColor={canonical.avatarColor}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-txt-primary truncate">
          {friendDisplayName}
        </div>
        <div className="text-[11px] text-txt-tertiary truncate">
          {isInDm ? t('dm:addMember.alreadyInDm') : `@${canonical.username}`}
        </div>
      </div>
      {!isInDm && (
        <div
          className={`w-[18px] h-[18px] rounded flex-shrink-0 flex items-center justify-center ${
            isSelected
              ? 'bg-accent-mint'
              : 'border-2 border-border-hard'
          }`}
        >
          {isSelected && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-surface-base">
              <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      )}
    </button>
  );
}

function AddDmBotRow({
  bot,
  isInDm,
  isSelected,
  atCapacity,
  isAdding,
  onToggle,
}: {
  bot: BotSummary;
  isInDm: boolean;
  isSelected: boolean;
  atCapacity: boolean;
  isAdding: boolean;
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation(['dm']);
  const name = bot.displayName || bot.username;
  return (
    <button
      onClick={() => onToggle(bot.id)}
      disabled={isInDm || isAdding || atCapacity}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-[4px] transition-colors text-left ${
        isInDm ? 'opacity-40 cursor-not-allowed' : isSelected ? 'bg-accent-mint/[0.08]' : 'hover:bg-interactive-hover'
      } ${atCapacity && !isInDm ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <Avatar
        src={uploadUrl(bot.avatar)}
        name={name}
        size={30}
        avatarColor={bot.avatarColor}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-txt-primary truncate">{name}</div>
        <div className="text-[11px] text-txt-tertiary truncate">
          {isInDm ? t('dm:addMember.alreadyInDm') : `@${bot.username}`}
        </div>
      </div>
      {!isInDm && (
        <div
          className={`w-[18px] h-[18px] rounded flex-shrink-0 flex items-center justify-center ${
            isSelected ? 'bg-accent-mint' : 'border-2 border-border-hard'
          }`}
        >
          {isSelected && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-surface-base">
              <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      )}
    </button>
  );
}

export function AddDmMemberModal() {
  const { t } = useTranslation(['dm', 'common']);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [bots, setBots] = useState<BotSummary[]>([]);
  const [selectedBotIds, setSelectedBotIds] = useState<Set<string>>(new Set());
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData);
  const closeModal = useUIStore((s) => s.closeModal);
  const dmChannels = useSpaceStore((s) => s.dmChannels);
  const upsertDmChannel = useSpaceStore((s) => s.upsertDmChannel);
  const friends = useSocialStore((s) => s.friends);
  const navigate = useNavigate();
  const selfId = useAuthStore(s => s.user?.id);
  const revision = useAuthStore(s => s.sessionRevision);
  const inputRef = useRef<HTMLInputElement>(null);

  const isOpen = activeModal === 'addDmMember';
  const dmChannelId = modalData.dmChannelId as string | undefined;
  const dmChannel = dmChannels.find(dm => dm.id === dmChannelId);
  // Native roster IDs are also the selection and membership keys.
  const currentMemberKeys = useMemo(
    () => new Set(dmChannel?.members.map(m => m.id) ?? []),
    [dmChannel?.members],
  );
  const memberCount = dmChannel?.members.length ?? 0;
  const maxMembers = 10;
  const remainingSlots = maxMembers - memberCount;

  // Filter friends: client-side search, exclude self
  const filteredFriends = useMemo(() => {
    const q = query.trim().toLowerCase();
    return friends.filter((f) => {
      if (f.id === selfId) return false;
      if (!q) return true;
      const displayName = (f.displayName ?? '').toLowerCase();
      const username = f.username.toLowerCase();
      return displayName.includes(q) || username.includes(q);
    });
  }, [friends, query, selfId]);

  // Reset state when modal opens
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (isOpen) {
      setQuery('');
      setSelected(new Set());
      setError('');
      setIsAdding(false);
      setSelectedBotIds(new Set());
      void api.bots.list().then(res => { if (alive) setBots(res.bots); }).catch(() => { if (alive) setBots([]); });
      timer = setTimeout(() => inputRef.current?.focus(), 100);
    }
    return () => { alive = false; clearTimeout(timer); };
  }, [isOpen, dmChannelId, revision]);

  const toggleFriend = (key: string) => {
    if (currentMemberKeys.has(key)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        // Enforce remaining capacity
        if (next.size + selectedBotIds.size >= remainingSlots) return prev;
        next.add(key);
      }
      return next;
    });
  };

  const removeFriend = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const selectedFriends = useMemo(
    () => friends.filter(f => selected.has(f.id)),
    [friends, selected],
  );

  const filteredBots = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bots.filter((b) => {
      if (!q) return true;
      return (b.displayName ?? '').toLowerCase().includes(q) || b.username.toLowerCase().includes(q);
    });
  }, [bots, query]);

  const selectedBots = useMemo(
    () => bots.filter((b) => selectedBotIds.has(b.id)),
    [bots, selectedBotIds],
  );

  // Owned bots use native account IDs, exactly like friends.
  const botIsInDm = (bot: BotSummary): boolean =>
    currentMemberKeys.has(bot.id);

  const toggleBot = (botId: string) => {
    const bot = bots.find((b) => b.id === botId);
    if (!bot || botIsInDm(bot)) return;
    setSelectedBotIds((prev) => {
      const next = new Set(prev);
      if (next.has(botId)) {
        next.delete(botId);
      } else {
        if (selected.size + next.size >= remainingSlots) return prev;
        next.add(botId);
      }
      return next;
    });
  };

  const totalSelected = selectedFriends.length + selectedBots.length;

  const handleSubmit = async () => {
    if (!dmChannelId || !dmChannel || isAdding || totalSelected === 0) return;
    setError('');
    setIsAdding(true);
    const current = () => revision === useAuthStore.getState().sessionRevision;
    try {
      if (!dmChannel.ownerId) {
        // 1-on-1 DM → create a new group DM with all selected + existing other member
        const partner = dmChannel.members.find(m => m.id !== selfId);
        if (!partner) {
          setError(t('dm:addMember.noOtherMember'));
          setIsAdding(false);
          return;
        }
        const users = [partner, ...selectedFriends, ...selectedBots].map(user => ({ id: user.id }));
        const newChannel = await api.dm.createGroup({ users, fromDmChannelId: dmChannelId });
        if (!current()) return;
        const rowId = upsertDmChannel(newChannel);
        closeModal();
        navigate(`/channels/@me/${rowId}`);
      } else {
        // Existing native group → retain sequential additions and server checks.
        for (const target of [...selectedFriends, ...selectedBots]) {
          if (!current()) return;
          await api.dm.addMember(dmChannelId, { userId: target.id });
        }
        if (current()) closeModal();
      }
    } catch (err) {
      if (current()) setError((err as Error).message || t('dm:addMember.failed'));
    } finally {
      if (current()) setIsAdding(false);
    }
  };

  const buttonText = totalSelected === 0
    ? t('dm:addMember.selectFriends')
    : t('dm:addMember.addCount', { count: totalSelected });

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title={t('dm:addMember.title')} mobileStyle="sheet">
      <div className="space-y-3">
        {/* Header with member count */}
        <div className="flex items-center justify-between">
          <p className="text-[13px] text-txt-tertiary">
            {t('dm:addMember.description')}
          </p>
          <span className="text-[12px] text-txt-tertiary flex-shrink-0 ml-2">
            {t('dm:addMember.capacity', { current: memberCount, max: maxMembers })}
          </span>
        </div>

        {/* Selected chips */}
        {selectedFriends.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {selectedFriends.map((f) => (
              <span
                key={f.id}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] bg-accent-mint/15 text-accent-mint"
              >
                {userDisplayName(f)}
                <button
                  onClick={() => removeFriend(f.id)}
                  className="opacity-60 hover:opacity-100 transition-opacity text-[14px] leading-none"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Search input */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('dm:addMember.searchPlaceholder')}
          className="input-search w-full py-2 text-[14px]"
          disabled={remainingSlots <= 0}
        />

        {remainingSlots <= 0 && (
          <p className="text-txt-danger text-[13px]">{t('dm:addMember.limitReached', { max: maxMembers })}</p>
        )}

        {error && (
          <p className="text-txt-danger text-[13px]">{error}</p>
        )}

        {/* Friend list */}
        <div className="max-h-[300px] overflow-y-auto space-y-[2px]">
          {filteredFriends.length === 0 && filteredBots.length === 0 && (
            <div className="py-4 text-center text-txt-tertiary text-[14px]">
              {query.trim() ? t('dm:addMember.noMatch') : t('dm:addMember.noFriends')}
            </div>
          )}

          {filteredFriends.map((friend) => {
            const key = friend.id;
            const isInDm = currentMemberKeys.has(key);
            const isSelected = selected.has(key);
            const atCapacity = !isSelected && selected.size + selectedBotIds.size >= remainingSlots;
            return (
              <AddDmFriendRow
                key={key}
                friend={friend}
                isInDm={isInDm}
                isSelected={isSelected}
                atCapacity={atCapacity}
                isAdding={isAdding}
                onToggle={toggleFriend}
              />
            );
          })}
          {filteredBots.length > 0 && (
            <>
              <div className="px-3 pt-3 pb-1 text-[11px] font-semibold text-txt-tertiary uppercase tracking-wider">
                {t('dm:addMember.yourBots')}
              </div>
              {filteredBots.map((bot) => {
                const isInDm = botIsInDm(bot);
                const isSelected = selectedBotIds.has(bot.id);
                const atCapacity = !isSelected && selected.size + selectedBotIds.size >= remainingSlots;
                return (
                  <AddDmBotRow
                    key={bot.id}
                    bot={bot}
                    isInDm={isInDm}
                    isSelected={isSelected}
                    atCapacity={atCapacity}
                    isAdding={isAdding}
                    onToggle={toggleBot}
                  />
                );
              })}
            </>
          )}
        </div>

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={totalSelected === 0 || isAdding}
          className="w-full py-2 rounded-md text-[13px] font-semibold transition-colors bg-accent-mint text-surface-base hover:bg-accent-mint/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isAdding ? t('dm:addMember.adding') : buttonText}
        </button>
      </div>
    </Modal>
  );
}
