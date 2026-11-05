import type { ReactNode } from 'react';
import type { User } from '@backspace/shared';
import type { JunoPerson } from '@backspace/shared/src/juno';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../ui/Avatar';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import { uploadUrlOn } from '../../utils/assetUrls';
import { JUNO_ASSETS } from './junoAssets';

interface BadgeProps { person: JunoPerson; origin: string; spaceId: string; active?: boolean; next?: boolean; self?: boolean; detail?: ReactNode }
export function JunoPlayerBadge(props: BadgeProps) {
  // A host-hydrated row carries its issuing origin. Never substitute an id-only roster hit.
  const { t } = useTranslation('voice');
  if (props.person.computer) return <Badge {...props} name={t('juno.botName', { number: props.person.computer })} />;
  const user = props.person.user?.id === props.person.userId ? props.person.user : undefined;
  return user ? <KnownPlayer key={`${props.origin}:${props.spaceId}:${user.id}`} {...props} user={user} />
    : <Badge {...props} name={props.person.name} />;
}
function KnownPlayer(props: BadgeProps & { user: User }) {
  const user = useCanonicalUserView(props.user, props.origin);
  return <Badge {...props} user={user} name={user.isDeleted ? props.person.name : props.person.nickname ?? user.displayName ?? user.username} />;
}
function Badge({ person, origin, active, next, self, detail, name, user }: BadgeProps & { name: string; user?: User }) {
  const { t } = useTranslation('voice');
  return <div aria-current={active ? 'true' : undefined} className={`juno-player-badge${active ? ' juno-player-active' : ''}${next ? ' juno-player-next' : ''}`}>
    <span className="juno-avatar-frame">
      {person.computer ? <span className="juno-computer-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="5" y="6" width="14" height="14" rx="4" /><path d="M12 2v4M2 11h3m14 0h3M9 16h6" /><circle cx="9" cy="11" r="1" /><circle cx="15" cy="11" r="1" /></svg></span>
        : <Avatar src={user && !user.isDeleted ? uploadUrlOn(user.avatar, origin) : null} name={name} user={user} userId={person.userId} size={32} />}
      <img src={JUNO_ASSETS.avatarFrame} alt="" aria-hidden="true" draggable={false} />
    </span>
    {next && <span className="juno-next-marker" title={t('juno.nextTurn')} aria-label={t('juno.nextTurn')}>›</span>}
    <span className="juno-player-copy"><strong title={name}>{name}{self && <small>{t('juno.you')}</small>}</strong>
      {detail && <span>{detail}</span>}
    </span>
  </div>;
}
