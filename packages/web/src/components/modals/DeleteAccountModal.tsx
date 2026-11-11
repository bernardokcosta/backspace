import { useState, useEffect, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { api } from '../../api/client';
import { describeError } from '../../i18n/errors';

interface DeleteAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'warning' | 'confirm' | 'complete';

interface OwnedSpaceInfo {
  id: string;
  name: string;
  members: { userId: string; username: string; displayName: string | null }[];
  action: 'none' | 'transfer' | 'delete';
  transferTo: string;
}

export function DeleteAccountModal({ isOpen, onClose }: DeleteAccountModalProps) {
  const revision = useAuthStore(s => s.sessionRevision);
  return isOpen ? <DeleteAccountContent key={revision} onClose={onClose} revision={revision} /> : null;
}

function DeleteAccountContent({ onClose, revision }: { onClose: () => void; revision: number }) {
  const { t } = useTranslation(['settings', 'common']);
  const user = useAuthStore((s) => s.user);
  const spaces = useSpaceStore((s) => s.spaces);

  const [step, setStep] = useState<Step>('warning');
  const [ownedSpaces, setOwnedSpaces] = useState<OwnedSpaceInfo[]>(() => spaces.filter(space => space.ownerId === user?.id)
    .map(space => ({ id: space.id, name: space.name, members: [], action: 'none', transferTo: '' })));
  const [ownedLoaded, setOwnedLoaded] = useState(ownedSpaces.length === 0);
  const [confirmUsername, setConfirmUsername] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const alive = useRef(true);
  const writing = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = () => alive.current && revision === useAuthStore.getState().sessionRevision;

  // Resolve the owned-space snapshot before offering account confirmation.
  useEffect(() => {
    let active = true;
    if (user && ownedSpaces.length > 0) {
      void Promise.all(ownedSpaces.map(async (s) => {
        try {
          const members = await api.spaces.members(s.id);
          return { ...s, members: members.filter(member => member.userId !== user.id).map(member => ({
            userId: member.userId, username: member.user.username, displayName: member.user.displayName,
          })) };
        } catch {
          return s;
        }
      })).then(rows => {
        if (!active || revision !== useAuthStore.getState().sessionRevision) return;
        setOwnedSpaces(rows); setOwnedLoaded(true);
      });
    }
    return () => { active = false; };
  }, [user?.id, revision]);

  // Auto-redirect after deletion — must be before early return to maintain hooks order
  useEffect(() => {
    if (step === 'complete') {
      const timer = setTimeout(() => {
        if (revision !== useAuthStore.getState().sessionRevision) return;
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [step, revision]);

  if (!user) return null;

  const allOwnedHandled = ownedSpaces.every(s => s.action !== 'none');

  const handleSpaceAction = (spaceId: string, action: 'transfer' | 'delete') => {
    setOwnedSpaces(prev => prev.map(s =>
      s.id === spaceId ? { ...s, action, transferTo: action === 'transfer' ? s.transferTo : '' } : s
    ));
  };

  const handleTransferTo = (spaceId: string, userId: string) => {
    setOwnedSpaces(prev => prev.map(s =>
      s.id === spaceId ? { ...s, transferTo: userId } : s
    ));
  };

  const handleContinueFromWarning = async () => {
    if (!current() || writing.current || !ownedLoaded || !allOwnedHandled || ownedSpaces.some(space => space.action === 'transfer' && !space.transferTo)) return;
    writing.current = true;
    setError('');
    setIsLoading(true);

    try {
      // Process owned spaces
      for (const space of ownedSpaces) {
        if (!current()) return;
        if (space.action === 'transfer' && space.transferTo) {
          await useSpaceStore.getState().transferOwnership(space.id, space.transferTo);
        } else if (space.action === 'delete') {
          await useSpaceStore.getState().deleteSpace(space.id);
        }
      }
      if (current()) setStep('confirm');
    } catch (err) {
      if (current()) setError(err instanceof Error ? describeError(err) : t('settings:account.deletion.errors.spacesFailed'));
    } finally {
      writing.current = false;
      if (current()) setIsLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!current() || writing.current || !confirmPassword) return;
    if (confirmUsername !== user.username) {
      setError(t('settings:account.deletion.errors.usernameMismatch'));
      return;
    }

    setError('');
    setIsLoading(true);
    writing.current = true;

    try {
      // Keep the completion view until the existing delayed logout, but never
      // let an earlier session's completion expire a replacement login.
      await api.users.deleteAccount({ password: confirmPassword, username: confirmUsername });
      if (current()) setStep('complete');
    } catch (err) {
      if (current()) setError(err instanceof Error ? describeError(err) : t('settings:account.deletion.errors.deleteFailed'));
    } finally {
      writing.current = false;
      if (current()) setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-surface-overlay" onClick={step !== 'complete' ? onClose : undefined} />
      <div className="relative max-w-lg w-full mx-4 max-h-[calc(calc(100*var(--app-vh))-2rem)] flex flex-col bg-surface-elevated rounded-lg shadow-xl animate-slide-up overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 flex-shrink-0">
          <h2 className="text-lg font-bold text-txt-primary">{t('settings:account.deletion.title')}</h2>
          {step !== 'complete' && (
            <button onClick={onClose} className="text-txt-tertiary hover:text-txt-primary transition-colors p-1" aria-label={t('common:actions.close')}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {/* Step 1: Warning & Space Handling */}
          {step === 'warning' && (
            <>
              <div className="bg-accent-rose/10 border border-accent-rose/20 rounded-lg p-3.5">
                <p className="text-sm text-txt-primary font-medium mb-2">{t('settings:account.deletion.warning.headline')}</p>
                <ul className="text-xs text-txt-secondary space-y-1">
                  <li>- {t('settings:account.deletion.warning.spaces')}</li>
                  <li>- {t('settings:account.deletion.warning.friends')}</li>
                  <li>- {t('settings:account.deletion.warning.dms')}</li>
                  <li>- {t('settings:account.deletion.warning.messages')}</li>
                </ul>
              </div>

              {ownedSpaces.length > 0 && (
                <div>
                  <p className="text-sm text-txt-primary font-medium mb-2">
                    {t('settings:account.deletion.ownedSpaces.prompt', { count: ownedSpaces.length })}
                  </p>
                  <div className="space-y-3">
                    {ownedSpaces.map(space => (
                      <div key={space.id} className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-3">
                        <div className="text-sm font-medium text-txt-primary mb-2">{space.name}</div>
                        <div className="flex gap-2 mb-2">
                          <button
                            onClick={() => handleSpaceAction(space.id, 'transfer')}
                            className={`px-2.5 py-1 text-xs rounded transition-colors ${
                              space.action === 'transfer'
                                ? 'bg-accent-primary text-white'
                                : 'bg-white/[0.06] text-txt-secondary hover:text-txt-primary'
                            }`}
                          >
                            {t('settings:account.deletion.ownedSpaces.transfer')}
                          </button>
                          <button
                            onClick={() => handleSpaceAction(space.id, 'delete')}
                            className={`px-2.5 py-1 text-xs rounded transition-colors ${
                              space.action === 'delete'
                                ? 'bg-accent-rose text-white'
                                : 'bg-white/[0.06] text-txt-secondary hover:text-txt-primary'
                            }`}
                          >
                            {t('settings:account.deletion.ownedSpaces.delete')}
                          </button>
                        </div>
                        {space.action === 'transfer' && (
                          <select
                            value={space.transferTo}
                            onChange={(e) => handleTransferTo(space.id, e.target.value)}
                            className="input-standard w-full px-2.5 py-1.5 text-xs"
                          >
                            <option value="">{t('settings:account.deletion.ownedSpaces.selectOwner')}</option>
                            {space.members.map(m => (
                              <option key={m.userId} value={m.userId}>
                                {m.displayName || m.username}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="p-2 bg-accent-rose/10 border border-accent-rose/30 rounded text-txt-danger text-xs">{error}</div>
              )}

              <button
                onClick={handleContinueFromWarning}
                disabled={
                  isLoading || !ownedLoaded ||
                  (ownedSpaces.length > 0 && (!allOwnedHandled || ownedSpaces.some(s => s.action === 'transfer' && !s.transferTo)))
                }
                className="w-full py-2 bg-accent-rose hover:bg-accent-rose/80 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? t('settings:account.deletion.processing') : t('common:actions.continue')}
              </button>
            </>
          )}

          {/* Step 2: Confirmation */}
          {step === 'confirm' && (
            <form onSubmit={(e) => { e.preventDefault(); handleConfirmDelete(); }} className="space-y-4">
              <div className="bg-accent-rose/10 border border-accent-rose/20 rounded-lg p-3.5">
                <p className="text-sm text-txt-danger font-medium">{t('settings:account.deletion.confirm.permanent')}</p>
              </div>

              <div>
                <label className="block text-xs text-txt-secondary mb-1.5">
                  <Trans
                    t={t}
                    i18nKey="settings:account.deletion.confirm.usernamePrompt"
                    values={{ username: user.username }}
                    components={{ username: <span className="font-mono text-txt-primary" /> }}
                  />
                </label>
                <input
                  type="text"
                  value={confirmUsername}
                  onChange={(e) => setConfirmUsername(e.target.value)}
                  className="input-danger w-full"
                  placeholder={user.username}
                />
              </div>

              <div>
                <label className="block text-xs text-txt-secondary mb-1.5">{t('common:labels.password')}</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input-danger w-full"
                  placeholder={t('settings:account.deletion.confirm.passwordPlaceholder')}
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <div className="p-2 bg-accent-rose/10 border border-accent-rose/30 rounded text-txt-danger text-xs">{error}</div>
              )}

              <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => { setStep('warning'); setError(''); }}
                  className="flex-1 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-txt-secondary text-sm font-medium rounded-lg transition-colors"
                >
                  {t('common:actions.back')}
                </button>
                <button
                  type="submit"
                  disabled={isLoading || confirmUsername !== user.username || !confirmPassword}
                  className="flex-1 py-2 bg-accent-rose hover:bg-accent-rose/80 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? t('settings:account.deletion.confirm.deleting') : t('settings:account.deletion.confirm.submit')}
                </button>
              </div>
            </form>
          )}

          {/* Step 3: Complete */}
          {step === 'complete' && (
            <div className="text-center py-6">
              <svg className="w-12 h-12 text-txt-tertiary mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-lg font-medium text-txt-primary mb-1">{t('settings:account.deletion.complete.title')}</p>
              <p className="text-sm text-txt-tertiary">{t('settings:account.deletion.complete.redirecting')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
