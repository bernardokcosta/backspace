import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Avatar } from '../ui/Avatar';
import { useUIStore } from '../../stores/uiStore';
import { api } from '../../api/client';
import type { User } from '@veyvox/shared';
import { userDisplayName } from '../../utils/identity';
import { useAuthStore } from '../../stores/authStore';
import { openDirectMessage } from '../../utils/openDirectMessage';
import { useCanonicalUserView } from '../../utils/userViewLookup';

function NewDmUserRow({
  user,
  onSelect,
}: {
  user: User;
  onSelect: (user: User) => void;
}) {
  // Search results come from the page's own instance.
  const canonical = useCanonicalUserView(user);
  const displayName = userDisplayName(canonical);
  return (
    <button
      onClick={() => onSelect(user)}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-[4px] hover:bg-interactive-hover transition-colors text-left"
    >
      <Avatar src={canonical.avatar} name={displayName} size={36} status={canonical.status} userId={canonical.id} avatarColor={canonical.avatarColor} />
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium text-txt-primary truncate">
          {displayName}
        </div>
        <div className="text-[12px] text-txt-tertiary truncate">@{canonical.username}</div>
      </div>
    </button>
  );
}

export function NewDmModal() {
  const revision = useAuthStore(s => s.sessionRevision);
  return <NewDmContent key={revision} revision={revision} />;
}

function NewDmContent({ revision }: { revision: number }) {
  const { t } = useTranslation(['dm', 'common']);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState('');
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const isOpen = activeModal === 'newDm';

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setError('');
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    let alive = true;
    const current = () => alive && revision === useAuthStore.getState().sessionRevision;
    setResults([]);
    if (!isOpen || query.trim().length < 2) {
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const timer = setTimeout(async () => {
      if (!current()) return;
      try {
        const users = await api.social.search(query.trim());
        if (current()) setResults(users);
      } catch {
        if (current()) setResults([]);
      } finally {
        if (current()) setIsSearching(false);
      }
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [isOpen, query, revision]);

  const handleSelectUser = async (user: User) => {
    setError('');
    try {
      const rowId = await openDirectMessage(user.id);
      if (revision !== useAuthStore.getState().sessionRevision) return;
      closeModal();
      useUIStore.getState().setShowDms(true);
      navigate(`/channels/@me/${rowId}`);
    } catch (err) {
      if (revision === useAuthStore.getState().sessionRevision) setError((err as Error).message || t('dm:search.createFailed'));
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title={t('dm:newDm.title')} mobileStyle="sheet">
      <div className="space-y-3">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setError(''); }}
          placeholder={t('dm:newDm.searchPlaceholder')}
          className="input-search w-full py-2 text-[14px]"
        />

        {error && (
          <p className="text-txt-danger text-[13px]">{error}</p>
        )}

        <div className="max-h-[300px] overflow-y-auto space-y-[2px]">
          {isSearching && (
            <div className="py-4 text-center text-txt-tertiary text-[14px]">{t('dm:search.searching')}</div>
          )}

          {!isSearching && query.trim().length >= 2 && results.length === 0 && (
            <div className="py-4 text-center text-txt-tertiary text-[14px]">{t('dm:newDm.noUsers')}</div>
          )}

          {results.map((user) => (
            <NewDmUserRow
              key={user.id}
              user={user}
              onSelect={handleSelectUser}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}
