import { useState, useRef, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { Trans, useTranslation } from 'react-i18next';
import type { MemberWithUser } from '@veyvox/shared';
import { useSpaceStore } from '../../stores/spaceStore';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import { Avatar } from '../ui/Avatar';

function TransferMemberRow({
  member,
  onSelect,
}: {
  member: MemberWithUser;
  onSelect: (userId: string) => void;
}) {
  const canonical = useCanonicalUserView(member.user);
  const displayName = canonical.displayName || canonical.username;
  return (
    <button
      onClick={() => onSelect(member.userId)}
      className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md hover:bg-white/[0.06] transition-colors"
    >
      <Avatar
        src={canonical.avatar}
        name={displayName}
        size={32}
        user={canonical}
        userId={member.userId}
      />
      <div className="flex flex-col items-start min-w-0">
        <span className="text-sm text-txt-primary truncate max-w-full">
          {displayName}
        </span>
        {canonical.displayName && (
          <span className="text-[11px] text-txt-tertiary truncate max-w-full">
            {canonical.username}
          </span>
        )}
      </div>
    </button>
  );
}

export function TransferOwnershipModal({ spaceId, onClose }: { spaceId: string; onClose: () => void }) {
  const revision = useAuthStore(s => s.sessionRevision);
  return <TransferOwnershipContent key={JSON.stringify([revision, spaceId])} spaceId={spaceId} onClose={onClose} revision={revision} />;
}

function TransferOwnershipContent({ spaceId, onClose, revision }: { spaceId: string; onClose: () => void; revision: number }) {
  const { t } = useTranslation(['spaces', 'common']);
  const modalRef = useRef<HTMLDivElement>(null);
  const space = useSpaceStore((s) => s.spaces.find(sp => sp.id === spaceId));
  const currentUserId = useAuthStore((s) => s.user?.id);
  const transferOwnership = useSpaceStore((s) => s.transferOwnership);
  const addToast = useUIStore((s) => s.addToast);

  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [members, setMembers] = useState<MemberWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = () => alive.current && revision === useAuthStore.getState().sessionRevision;

  // Read only the target space's native roster, owned by the current session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fetched = await api.spaces.members(spaceId);
        if (cancelled || revision !== useAuthStore.getState().sessionRevision) return;
        for (const m of fetched) {
          useSpaceStore.getState().upsertUserView(m.user);
        }
        setMembers(fetched);
      } catch {
        // Space may have been deleted or we lost access
      } finally {
        if (!cancelled && revision === useAuthStore.getState().sessionRevision) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [spaceId, revision]);

  // Filter members: exclude self, filter by search
  const filteredMembers = useMemo(() => {
    const spaceMembers = members.filter(m => m.userId !== currentUserId);
    if (!search.trim()) return spaceMembers;
    const q = search.toLowerCase();
    return spaceMembers.filter(m =>
      m.user.displayName?.toLowerCase().includes(q) ||
      m.user.username.toLowerCase().includes(q)
    );
  }, [members, currentUserId, search]);

  const selectedMember = selectedUserId ? members.find(m => m.userId === selectedUserId) : null;

  // Close on click-outside and escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedUserId) {
          setSelectedUserId(null);
        } else {
          onClose();
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, selectedUserId]);

  if (!space) return null;

  const handleTransfer = async () => {
    if (!selectedUserId || !current() || transferring) return;
    setTransferring(true);
    try {
      await transferOwnership(spaceId, selectedUserId);
      if (!current()) return;
      addToast(t('spaces:ownership.success', { name: selectedMember?.user.displayName || selectedMember?.user.username }), 'success', 3000);
      onClose();
    } catch (err) {
      if (current()) addToast(err instanceof Error ? err.message : t('spaces:ownership.failed'), 'warning', 3000);
    } finally {
      if (current()) setTransferring(false);
    }
  };

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50">
      <div
        ref={modalRef}
        className="w-[380px] max-h-[480px] glass-modal rounded-xl flex flex-col animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-white/[0.06]">
          <h3 className="text-base font-semibold text-txt-primary">{t('spaces:ownership.title')}</h3>
          <p className="text-xs text-txt-tertiary mt-0.5">
            <Trans
              t={t}
              i18nKey="spaces:ownership.description"
              values={{ name: space.name }}
              components={{ name: <span className="font-medium text-txt-secondary" /> }}
            />
          </p>
        </div>

        {selectedUserId && selectedMember ? (
          /* Confirm step */
          <div className="p-4 flex flex-col gap-4">
            <div className="p-3 rounded-lg bg-accent-amber/10 border border-accent-amber/20">
              <p className="text-sm text-txt-secondary">
                <Trans
                  t={t}
                  i18nKey="spaces:ownership.confirmQuestion"
                  values={{ space: space.name, member: selectedMember.user.displayName || selectedMember.user.username }}
                  components={{ name: <span className="font-semibold text-txt-primary" /> }}
                />
              </p>
              <p className="text-xs text-txt-tertiary mt-1.5">{t('spaces:ownership.regularMember')}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setSelectedUserId(null)}
                className="flex-1 py-2.5 text-sm font-medium text-txt-secondary bg-interactive-hover hover:bg-interactive-selected rounded-lg transition-colors disabled:opacity-50"
                disabled={transferring}
              >
                {t('common:actions.cancel')}
              </button>
              <button
                onClick={handleTransfer}
                disabled={transferring}
                className="flex-1 py-2.5 bg-accent-amber hover:bg-accent-amber/80 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {transferring ? t('spaces:ownership.transferring') : t('spaces:ownership.confirm')}
              </button>
            </div>
          </div>
        ) : (
          /* Member list */
          <>
            <div className="px-3 pt-3">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('common:labels.searchMembers')}
                className="input-search w-full"
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-y-auto p-2 min-h-0">
              {loading ? (
                <p className="text-xs text-txt-tertiary text-center py-4">{t('spaces:ownership.loading')}</p>
              ) : filteredMembers.length === 0 ? (
                <p className="text-xs text-txt-tertiary text-center py-4">{t('common:labels.noMembersFound')}</p>
              ) : (
                filteredMembers.map((member) => (
                  <TransferMemberRow
                    key={member.userId}
                    member={member}
                    onSelect={setSelectedUserId}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
