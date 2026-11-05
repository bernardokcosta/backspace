import type { ReactNode } from 'react';
import type { User } from '@backspace/shared';
import type { JunoPerson } from '@backspace/shared/src/juno';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../ui/Avatar';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import { uploadUrlOn } from '../../utils/assetUrls';
import { JUNO_ASSETS } from './junoAssets';

interface BadgeProps { person: JunoPerson; origin: string; spaceId: string; active?: boolean; self?: boolean; detail?: ReactNode }
export function JunoPlayerBadge(props: BadgeProps) {
  // A host-hydrated row carries its issuing origin. Never substitute an id-only roster hit.
  const user = props.person.user?.id === props.person.userId ? props.person.user : undefined;
  return user ? <KnownPlayer key={`${props.origin}:${props.spaceId}:${user.id}`} {...props} user={user} />
    : <Badge {...props} name={props.person.name} />;
}
function KnownPlayer(props: BadgeProps & { user: User }) {
  const user = useCanonicalUserView(props.user, props.origin);
  return <Badge {...props} user={user} name={user.isDeleted ? props.person.name : props.person.nickname ?? user.displayName ?? user.username} />;
}
function Badge({ person, origin, active, self, detail, name, user }: BadgeProps & { name: string; user?: User }) {
  const { t } = useTranslation('voice');
  return <div className={`juno-player-badge${active ? ' juno-player-active' : ''}`}>
    <span className="juno-avatar-frame">
      <Avatar src={user && !user.isDeleted ? uploadUrlOn(user.avatar, origin) : null} name={name} user={user} userId={person.userId} size={32} />
      <img src={JUNO_ASSETS.avatarFrame} alt="" aria-hidden="true" draggable={false} />
    </span>
    <span className="juno-player-copy"><strong title={name}>{name}{self && <small>{t('juno.you')}</small>}</strong>
      {detail && <span>{detail}</span>}
    </span>
  </div>;
}
