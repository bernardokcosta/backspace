import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import { useUIStore } from '../../stores/uiStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useAuthStore } from '../../stores/authStore';
import { parseInviteInput } from '../../utils/inviteParser';
import { describeError } from '../../i18n/errors';
import { isJoinRequestPendingError, isNotRequestableError, JoinRequestRequiredError } from '../../utils/joinErrors';
import { sendInviteJoinRequest, type InviteRequestOutcome } from '../../utils/inviteJoinRequest';

const JOIN_REQUEST_MESSAGE_MAX = 500;
type JoinPhase = 'input' | 'request' | 'request-sent';

export function JoinSpaceModal() {
  const revision = useAuthStore(s => s.sessionRevision);
  const active = useUIStore(s => s.activeModal === 'joinSpace');
  return active ? <JoinSpaceContent key={revision} revision={revision} /> : null;
}

function JoinSpaceContent({ revision }: { revision: number }) {
  const { t } = useTranslation(['spaces', 'common']);
  const [inviteCode, setInviteCode] = useState('');
  const [parsedCode, setParsedCode] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [phase, setPhase] = useState<JoinPhase>('input');
  const [requestSpaceId, setRequestSpaceId] = useState<string | null>(null);
  const [requestMessage, setRequestMessage] = useState('');
  const [requestOutcome, setRequestOutcome] = useState<InviteRequestOutcome>('sent');
  const closeModal = useUIStore(s => s.closeModal);
  const modalData = useUIStore(s => s.modalData);
  const joinByCode = useSpaceStore(s => s.joinByCode);
  const navigate = useNavigate();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = () => alive.current && revision === useAuthStore.getState().sessionRevision
    && useUIStore.getState().activeModal === 'joinSpace' && useUIStore.getState().modalData === modalData;

  const joinAndNavigate = async (code: string) => {
    if (!current()) return;
    try {
      const space = await joinByCode(code);
      if (!current()) return;
      closeModal(); navigate(`/channels/${space.id}`);
    } catch (err) {
      if (!current()) return;
      if (isJoinRequestPendingError(err)) {
        setRequestOutcome('pending'); setPhase('request-sent'); setError(''); return;
      }
      if (!(err instanceof JoinRequestRequiredError)) throw err;
      setRequestSpaceId(err.spaceId); setPhase('request'); setError('');
    }
  };

  const handleSendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestSpaceId || !current() || isLoading) return;
    setError(''); setIsLoading(true);
    try {
      const outcome = await sendInviteJoinRequest(requestSpaceId, requestMessage.trim() || undefined);
      if (!current()) return;
      setRequestOutcome(outcome); setPhase('request-sent');
    } catch (err) {
      if (!current()) return;
      if (isNotRequestableError(err)) {
        try { await joinAndNavigate(parsedCode); }
        catch (joinErr) { if (current()) setError(describeError(joinErr)); }
      } else setError(describeError(err));
    } finally { if (current()) setIsLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!current() || isLoading) return;
    setError('');
    try {
      const parsed = parseInviteInput(inviteCode);
      // Never strip a foreign host and accidentally admit a colliding local code.
      if (parsed.origin) throw new Error(t('spaces:join.validation.invalidLink'));
      setParsedCode(parsed.code); setIsLoading(true);
      await joinAndNavigate(parsed.code);
    } catch (err) { if (current()) setError(describeError(err)); }
    finally { if (current()) setIsLoading(false); }
  };

  return (
    <Modal isOpen onClose={closeModal} title={t('spaces:join.title')} mobileStyle="sheet">
      {error && <div className="mb-3 p-2 bg-accent-rose/10 border border-accent-rose/30 rounded text-txt-danger text-sm">{error}</div>}
      {phase === 'input' && (
        <div>
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <input type="text" value={inviteCode} onChange={e => setInviteCode(e.target.value)} className="input-standard w-full" placeholder={t('spaces:join.invitePlaceholder')} />
            </div>
            <div className="sticky bottom-0 z-10 pointer-events-none">
              <div className="flex justify-center pt-3 pb-1">
                <div className="glass-bubble rounded-full px-3 py-2 flex items-center gap-3 pointer-events-auto">
                  <button type="button" onClick={closeModal} className="px-3 py-1 text-sm text-txt-tertiary hover:text-txt-secondary transition-colors">{t('common:actions.cancel')}</button>
                  <button type="submit" disabled={isLoading || !inviteCode.trim()} className="px-3 py-1.5 bg-accent-primary hover:bg-accent-primary/80 text-white text-sm font-medium rounded-full transition-colors disabled:opacity-50">
                    {isLoading ? t('spaces:join.submitting') : t('spaces:join.submit')}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      )}
      {phase === 'request' && (
        <form onSubmit={handleSendRequest}>
          <p className="text-txt-secondary text-sm mb-3">{t('spaces:join.request.notice')}</p>
          <textarea value={requestMessage} onChange={e => setRequestMessage(e.target.value)} placeholder={t('spaces:join.request.messagePlaceholder')}
            aria-label={t('spaces:join.request.messageLabel')} maxLength={JOIN_REQUEST_MESSAGE_MAX} rows={3} disabled={isLoading} className="input-standard w-full mb-4 resize-none" autoFocus />
          <div className="sticky bottom-0 z-10 pointer-events-none">
            <div className="flex justify-center pt-3 pb-1">
              <div className="glass-bubble rounded-full px-3 py-2 flex items-center gap-3 pointer-events-auto">
                <button type="button" onClick={() => { setPhase('input'); setRequestSpaceId(null); setRequestMessage(''); setError(''); }}
                  className="px-3 py-1 text-sm text-txt-tertiary hover:text-txt-secondary transition-colors flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                  {t('common:actions.back')}
                </button>
                <div className="w-px h-5 bg-white/10" />
                <button type="button" onClick={closeModal} className="px-3 py-1 text-sm text-txt-tertiary hover:text-txt-secondary transition-colors">{t('common:actions.cancel')}</button>
                <button type="submit" disabled={isLoading} className="px-3 py-1.5 bg-accent-primary hover:bg-accent-primary/80 text-white text-sm font-medium rounded-full transition-colors disabled:opacity-50">
                  {isLoading ? t('spaces:join.request.sending') : t('spaces:join.request.send')}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}
      {phase === 'request-sent' && (
        <div role="status">
          <p className="text-txt-secondary text-sm mb-4">{requestOutcome === 'sent' ? t('spaces:join.request.sent') : t('spaces:join.request.pending')}</p>
          <div className="flex justify-end"><button type="button" onClick={closeModal} className="px-4 py-1.5 bg-accent-primary hover:bg-accent-primary/80 text-white text-sm font-medium rounded-full transition-colors">{t('common:actions.done')}</button></div>
        </div>
      )}
    </Modal>
  );
}
