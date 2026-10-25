/**
 * Which item of the DM sidebar's home block is selected.
 *
 * One function keeps the sidebar selection mutually exclusive.
 *
 * Friends is the retained home view when no channel is open. Old discovery
 * bookmarks redirect at the router rather than defining another home item.
 */

export type HomeNavItem = 'friends';

export function activeHomeNavItem(pathname: string, currentChannelId: string | null): HomeNavItem | null {
  if (currentChannelId === null) return 'friends';
  return null;
}
