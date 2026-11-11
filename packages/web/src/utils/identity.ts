/** A native account's display name, or its exact username (including retained @ handles). */
export function userDisplayName(user: { displayName?: string | null; username: string }): string {
  return user.displayName || user.username;
}

/** Nicknames apply inside their space only; DMs and profiles show the account name. */
export function spaceMemberName(
  member: { nickname?: string | null } | null | undefined,
  user: { displayName?: string | null; username: string },
): string {
  return member?.nickname || userDisplayName(user);
}
