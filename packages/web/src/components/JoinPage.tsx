import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/authStore';
import { useSpaceStore } from '../stores/spaceStore';
import { api } from '../api/client';
import { parseInviteInput } from '../utils/inviteParser';
import { Avatar } from './ui/Avatar';
import type { InvitePreview } from '@veyvox/shared';
import { describeError } from '../i18n/errors';
import { isAlreadyMemberError, isJoinRequestPendingError, isNotRequestableError, JoinRequestRequiredError } from '../utils/joinErrors';
import { sendInviteJoinRequest, type InviteRequestOutcome } from '../utils/inviteJoinRequest';

type JoinPhase = 'preview' | 'already-member' | 'request-sent';
type JoinAction = 'join' | 'request';
const JOIN_REQUEST_MESSAGE_MAX = 500;

export function JoinPage() {
  const revision = useAuthStore(s => s.sessionRevision);
  const { inviteCode } = useParams<{ inviteCode: string }>();
  return <JoinContent key={JSON.stringify([revision, inviteCode])} rawInviteCode={inviteCode} revision={revision} />;
}

function JoinContent({ rawInviteCode, revision }: { rawInviteCode?: string; revision: number }) {
  const { t } = useTranslation(['auth', 'common']);
  const navigate = useNavigate();
  const token = useAuthStore(s => s.token);
  const user = useAuthStore(s => s.user);
  const loadUser = useAuthStore(s => s.loadUser);
  const isAuthLoading = useAuthStore(s => s.isLoading);
  const userLoadError = useAuthStore(s => s.userLoadError);
  const logout = useAuthStore(s => s.logout);
  const joinByCode = useSpaceStore(s => s.joinByCode);

  // This is a public route, so hydrate without useAuth's signed-out redirect.
  useEffect(() => {
    if (token && !user && !isAuthLoading && !userLoadError) void loadUser();
  }, [token, user, isAuthLoading, userLoadError, loadUser]);

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [isLoadingPreview, setIsLoadingPreview] = useState(true);
  const [phase, setPhase] = useState<JoinPhase>('preview');
  const [error, setError] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [action, setAction] = useState<JoinAction>('join');
  const [requestSpaceId, setRequestSpaceId] = useState('');
  const [requestMessage, setRequestMessage] = useState('');
  const [requestOutcome, setRequestOutcome] = useState<InviteRequestOutcome>('sent');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = () => alive.current && revision === useAuthStore.getState().sessionRevision;

  const parsed = useMemo(() => {
    if (!rawInviteCode) return null;
    try { return parseInviteInput(rawInviteCode); } catch { return null; }
  }, [rawInviteCode]);

  useEffect(() => {
    if (!rawInviteCode || !parsed || parsed.origin) {
      setPreviewError(t(!rawInviteCode ? 'auth:join.errors.noCode' : 'auth:join.errors.invalidCode'));
      setIsLoadingPreview(false); return;
    }
    let active = true;
    void api.spaces.invitePreview(parsed.code).then(data => {
      if (!active || revision !== useAuthStore.getState().sessionRevision) return;
      setPreview(data); setAction(data.visibility === 'request' ? 'request' : 'join'); setRequestSpaceId(data.spaceId);
    }).catch(err => {
      if (active && revision === useAuthStore.getState().sessionRevision) setPreviewError(describeError(err));
    }).finally(() => { if (active && revision === useAuthStore.getState().sessionRevision) setIsLoadingPreview(false); });
    return () => { active = false; };
  }, [rawInviteCode, parsed, revision, t]);

  const proceed = async () => {
    if (!parsed || parsed.origin || !current()) return;
    if (action === 'request' && requestSpaceId) {
      try {
        const outcome = await sendInviteJoinRequest(requestSpaceId, requestMessage.trim() || undefined);
        if (!current()) return;
        setRequestOutcome(outcome); setPhase('request-sent'); return;
      } catch (err) {
        if (!current()) return;
        if (!isNotRequestableError(err)) throw err;
        setAction('join');
      }
    }
    try {
      const space = await joinByCode(parsed.code);
      if (current()) navigate(`/channels/${space.id}`);
    } catch (err) {
      if (!current()) return;
      if (isJoinRequestPendingError(err)) {
        setAction('request'); setRequestOutcome('pending'); setPhase('request-sent'); return;
      }
      if (!(err instanceof JoinRequestRequiredError)) throw err;
      setAction('request'); setRequestSpaceId(err.spaceId); setPhase('preview');
    }
  };

  const handleJoin = async () => {
    if (!current() || isJoining || !token || !user) return;
    setError(''); setIsJoining(true);
    try { await proceed(); }
    catch (err) {
      if (!current()) return;
      if (isAlreadyMemberError(err)) { setPhase('already-member'); setError(''); }
      else setError(describeError(err));
    } finally { if (current()) setIsJoining(false); }
  };
  const redirectParam = rawInviteCode ? `?redirect=/join/${encodeURIComponent(rawInviteCode)}` : '';

  if (isLoadingPreview) {
    return (
      <div className="h-full overflow-y-auto flex flex-col items-center bg-surface-base relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgb(var(--accent-primary)/0.06)_0%,transparent_50%)]" />
        <div className="my-auto flex-shrink-0 text-center relative z-10">
          <svg className="animate-spin w-10 h-10 text-accent-primary mx-auto mb-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          <p className="text-txt-tertiary">{t('auth:join.loading')}</p>
        </div>
      </div>
    );
  }
  if (previewError || !preview) {
    return (
      <div className="h-full overflow-y-auto flex flex-col items-center bg-surface-base relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgb(var(--accent-primary)/0.06)_0%,transparent_50%)]" />
        <div className="my-auto flex-shrink-0 w-full max-w-[480px] bg-surface-elevated rounded-md p-8 shadow-elevation-high relative z-10 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-accent-rose/10 flex items-center justify-center"><svg className="w-8 h-8 text-accent-rose" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008z" /></svg></div>
          <h1 className="text-xl font-bold text-txt-primary mb-2">{t('auth:join.invalid.title')}</h1>
          <p className="text-txt-secondary text-sm mb-6">{previewError || t('auth:join.invalid.description')}</p>
          {token ? <button onClick={() => navigate('/channels/@me')} className="px-6 py-2.5 bg-accent-primary hover:bg-accent-primary/80 text-white font-medium rounded transition-colors">{t('auth:join.invalid.backToApp')}</button>
            : <Link to="/login" className="inline-block px-6 py-2.5 bg-accent-primary hover:bg-accent-primary/80 text-white font-medium rounded transition-colors">{t('common:actions.logIn')}</Link>}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto flex flex-col items-center bg-surface-base relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgb(var(--accent-primary)/0.06)_0%,transparent_50%)]" />
      <div className="my-auto flex-shrink-0 w-full max-w-[480px] bg-surface-elevated rounded-md p-8 shadow-elevation-high relative z-10">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-4"><Avatar src={preview.icon} name={preview.spaceName} size={72} userId={preview.spaceId} avatarColor={preview.avatarColor} palette="space" /></div>
          <p className="text-xs text-txt-tertiary uppercase tracking-wide mb-1">{action === 'request' ? t('auth:join.invitedToRequest') : t('auth:join.invitedTo')}</p>
          <h1 className="text-2xl font-bold text-txt-primary">{preview.spaceName}</h1>
          {preview.description && <p className="text-txt-secondary text-sm mt-2">{preview.description}</p>}
          <div className="flex items-center justify-center gap-4 mt-3 text-xs text-txt-tertiary"><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-txt-tertiary/40" />{t('auth:join.memberCount', { count: preview.memberCount })}</span><span>{preview.instanceName}</span></div>
        </div>
        {error && <div className="mb-4 p-3 bg-accent-rose/10 border border-accent-rose/30 rounded text-txt-danger text-sm">{error}</div>}
        {phase === 'preview' && (
          <>
            {action === 'request' && <p className="mb-3 text-center text-txt-secondary text-sm">{t('auth:join.request.notice')}</p>}
            {token && user ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 bg-surface-input rounded-lg p-3"><Avatar src={user.avatar || null} name={user.displayName || user.username} size={40} avatarColor={user.avatarColor} /><div className="min-w-0"><p className="text-txt-primary font-medium text-sm truncate">{user.displayName || user.username}</p><p className="text-txt-tertiary text-xs truncate">@{user.username}</p></div></div>
                {action === 'request' && <textarea value={requestMessage} onChange={e => setRequestMessage(e.target.value)} placeholder={t('auth:join.request.messagePlaceholder')} aria-label={t('auth:join.request.messageLabel')} maxLength={JOIN_REQUEST_MESSAGE_MAX} rows={2} disabled={isJoining} className="input-standard w-full py-2 text-sm resize-none" />}
                <button onClick={handleJoin} disabled={isJoining} className="w-full py-2.5 bg-accent-primary hover:bg-accent-primary/80 text-white font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {action === 'request' ? (isJoining ? t('auth:join.request.sending') : t('auth:join.request.askAs', { name: user.displayName || user.username })) : (isJoining ? t('auth:join.joining') : t('auth:join.joinAs', { name: user.displayName || user.username }))}
                </button>
                <p className="text-center text-xs text-txt-tertiary">{t('auth:join.notYou')}{' '}<button type="button" onClick={() => { logout(); navigate(`/login${redirectParam}`); }} className="text-accent-primary hover:underline">{t('auth:join.switchAccount')}</button></p>
              </div>
            ) : token && userLoadError ? (
              <div className="space-y-3 text-center"><p role="alert" className="text-sm text-txt-secondary">{userLoadError}</p><button type="button" onClick={() => { void loadUser(); }} className="text-accent-primary hover:underline">{t('common:actions.tryAgain')}</button></div>
            ) : token ? (
              <button disabled className="w-full py-2.5 bg-accent-primary hover:bg-accent-primary/80 text-white font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{t('common:states.loading')}</button>
            ) : (
              <div className="space-y-3"><Link to={`/login${redirectParam}`} className="block w-full py-2.5 bg-accent-primary hover:bg-accent-primary/80 text-white font-medium rounded transition-colors text-center">{action === 'request' ? t('auth:join.request.loginToAsk') : t('auth:join.loginToJoin')}</Link><Link to={`/register${redirectParam}`} className="block w-full py-2.5 bg-surface-input hover:bg-surface-elevated text-txt-primary font-medium rounded transition-colors text-center">{t('auth:join.createAccount')}</Link></div>
            )}
          </>
        )}
        {phase === 'already-member' && <AlreadyMemberCard spaceName={preview.spaceName} spaceId={preview.spaceId} navigate={navigate} />}
        {phase === 'request-sent' && <RequestSentCard spaceName={preview.spaceName} outcome={requestOutcome} onDone={() => navigate('/channels/@me')} />}
      </div>
    </div>
  );
}

function RequestSentCard({ spaceName, outcome, onDone }: { spaceName: string; outcome: InviteRequestOutcome; onDone: () => void }) {
  const { t } = useTranslation(['auth']);
  return (
    <div className="text-center" role="status">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-accent-mint/10 flex items-center justify-center"><svg className="w-6 h-6 text-accent-mint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg></div>
      <p className="text-txt-primary font-medium mb-1">{outcome === 'sent' ? t('auth:join.requestSent.title', { space: spaceName }) : t('auth:join.requestSent.pendingTitle', { space: spaceName })}</p>
      <p className="text-txt-tertiary text-xs mb-4">{t('auth:join.requestSent.body')}</p>
      <button onClick={onDone} className="px-6 py-2.5 bg-accent-primary hover:bg-accent-primary/80 text-white font-medium rounded transition-colors">{t('auth:join.invalid.backToApp')}</button>
    </div>
  );
}

function AlreadyMemberCard({ spaceName, spaceId, navigate }: { spaceName: string; spaceId: string; navigate: (path: string) => void }) {
  const { t } = useTranslation(['auth']);
  useEffect(() => { const timer = setTimeout(() => navigate(`/channels/${spaceId}`), 2000); return () => clearTimeout(timer); }, [spaceId, navigate]);
  return (
    <div className="text-center">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-accent-mint/10 flex items-center justify-center"><svg className="w-6 h-6 text-accent-mint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg></div>
      <p className="text-txt-primary font-medium mb-1">{t('auth:join.alreadyMember.title', { space: spaceName })}</p>
      <p className="text-txt-tertiary text-xs mb-4">{t('auth:join.alreadyMember.redirecting')}</p>
      <button onClick={() => navigate(`/channels/${spaceId}`)} className="px-6 py-2.5 bg-accent-primary hover:bg-accent-primary/80 text-white font-medium rounded transition-colors">{t('auth:join.alreadyMember.go', { space: spaceName })}</button>
    </div>
  );
}
