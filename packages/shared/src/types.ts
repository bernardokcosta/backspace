import type { ErrorCode, ErrorDetails } from './errors.js';

// ─── Constants ──────────────────────────────────────────────────────────────

export const MAX_MESSAGE_LENGTH = 4000;
/** How many messages one text channel may hold pinned at once. */
export const MAX_PINS_PER_CHANNEL = 50;

// ─── User Types ─────────────────────────────────────────────────────────────

export const AVATAR_COLORS = ['mint', 'sky', 'lavender', 'coral', 'rose', 'teal', 'amber'] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

export interface User {
  /** Bot account (no password login). */
  isBot?: boolean;
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  banner: string | null;
  accentColor: string | null;
  avatarColor: AvatarColor | null;
  bio: string | null;
  status: UserStatus;
  customStatus: string | null;
  isAdmin: boolean;
  isDeleted?: boolean;
  discoverable?: boolean;
  profileUpdatedAt?: number;
  createdAt: number;
  showActivity?: boolean;
  /** Self-view only: Developer Mode is on, which shows the Bots tab in settings. Stored with the account, so every device agrees. */
  developerMode?: boolean;
}

export type UserStatus = 'online' | 'idle' | 'dnd' | 'offline';
/** A status a user can pick. 'offline' is never chosen: it means "no connection". */
export type ChosenUserStatus = Exclude<UserStatus, 'offline'>;

export const CHOSEN_USER_STATUSES: readonly ChosenUserStatus[] = ['online', 'idle', 'dnd'];

export function isChosenUserStatus(value: unknown): value is ChosenUserStatus {
  return typeof value === 'string' && (CHOSEN_USER_STATUSES as readonly string[]).includes(value);
}

export interface UserWithPassword extends User {
  passwordHash: string;
}

// ─── Space (Community) Types ─────────────────────────────────────────────────

export type SpaceVisibility = 'public' | 'request' | 'private';

export interface Space {
  id: string;
  name: string;
  icon: string | null;
  banner: string | null;
  avatarColor: AvatarColor | null;
  ownerId: string;
  /**
   * The owner group's heading in the member list, null for the default
   * ("Owner"). Absent from instances up to 1.10.0, which do not keep it; the
   * client reads it through `ownerGroupTitle` and `hostKeepsOwnerTitle`.
   */
  ownerTitle: string | null;
  inviteCode: string | null;
  visibility: SpaceVisibility;
  description: string | null;
  /**
   * Voice channel members idle longer than `afkTimeoutSeconds` are moved to,
   * or null/undefined when no AFK channel is configured (feature off).
   * Undefined on instances up to 1.13.x, which do not keep it.
   */
  afkChannelId?: string | null;
  /** Seconds of voice inactivity before the AFK move. Default 300. */
  afkTimeoutSeconds?: number;
  createdAt: number;
}

export interface InvitePreview {
  spaceId: string;
  spaceName: string;
  description: string | null;
  icon: string | null;
  avatarColor: AvatarColor | null;
  memberCount: number;
  instanceName: string;
  /**
   * The space's visibility when the preview was read. The invite page offers
   * a join request for `request` and a join otherwise. Absent from an
   * instance older than this field, where the page offers a join and switches
   * to a request when the join answers `join_request_required`.
   */
  visibility?: SpaceVisibility;
}

export interface JoinRequest {
  id: string;
  spaceId: string;
  userId: string;
  message: string | null;
  status: 'pending' | 'accepted' | 'declined';
  decidedBy: string | null;
  createdAt: number;
  decidedAt: number | null;
  user?: User;
}

export interface SpaceWithChannelsAndMembers extends Space {
  channels: Channel[];
  categories: ChannelCategory[];
  members: MemberWithUser[];
  roles: Role[];
  myPermissions?: string; // Computed per-user BigInt decimal string (space-level)
}

// ─── Member Types ───────────────────────────────────────────────────────────

export interface Member {
  spaceId: string;
  userId: string;
  nickname: string | null;
  joinedAt: number;
}

export interface MemberWithUser extends Member {
  user: User;
  roles: Role[];
}

// ─── Role Types ─────────────────────────────────────────────────────────────

export interface Role {
  id: string;
  spaceId: string;
  name: string;
  color: string;
  position: number;
  permissions?: string; // BigInt decimal string (bitwise)
  isEveryone?: boolean; // UI hint: true when role.id === space.id
  createdAt: number;
  /**
   * A bot's managed role: the bot it was created for when added to the space.
   * Only that bot holds it; it cannot be deleted or given to anyone else.
   * Absent on every other role.
   */
  managedBotId?: string;
}

// ─── Folder Types ───────────────────────────────────────────────────────────

export interface SpaceFolder {
  id: string;
  userId: string;
  name: string | null;
  color: string | null;
  position: number;
  spaceIds: string[];
}

// ─── Space Layout Types ────────────────────────────────────────────────────

export type SpaceLayoutItem =
  | { t: 's'; id: string }
  | { t: 'f'; id: string };

// ─── Channel Types ──────────────────────────────────────────────────────────

export type ChannelType = 'text' | 'voice';

export interface ChannelCategory {
  id: string;
  spaceId: string;
  name: string;
  position: number;
  isPrivate?: boolean;
  createdAt: number;
}

export interface CategoryOverride {
  categoryId: string;
  targetType: 'role' | 'member';
  targetId: string;
  allow: string;
  deny: string;
}

export interface Channel {
  id: string;
  spaceId: string;
  name: string;
  type: ChannelType;
  topic: string | null;
  position: number;
  categoryId: string | null;
  isPrivate?: boolean;
  createdAt: number;
  lastMessageId?: string | null;
  myPermissions?: string; // Computed per-user BigInt decimal string
}

export interface ReadState {
  channelId: string;
  lastReadMessageId: string;
}

// ─── Notification Settings ─────────────────────────────────────────────────
// Per-space and per-channel alert preferences, stored on the instance that
// hosts the space (docs/systems/sounds.md, "Notification settings").

/**
 * Which messages of a space channel alert the user (sound and desktop
 * notification). DMs are not governed by it.
 *
 * - `all`: every message from someone else.
 * - `mentions`: only messages that mention the user.
 * - `nothing`: no message, mentions included.
 */
export const NOTIFICATION_LEVELS = ['all', 'mentions', 'nothing'] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

/** The level of a space with no stored choice, and of every channel that inherits it. */
export const DEFAULT_NOTIFICATION_LEVEL: NotificationLevel = 'mentions';

export function isNotificationLevel(value: unknown): value is NotificationLevel {
  return typeof value === 'string' && (NOTIFICATION_LEVELS as readonly string[]).includes(value);
}

/**
 * How long a mute lasts. The server turns a duration into `mutedUntil` with
 * its own clock, so every session of the user sees the same end time.
 */
export const NOTIFICATION_MUTE_DURATIONS = ['1h', '8h', '24h', 'indefinite'] as const;
export type NotificationMuteDuration = (typeof NOTIFICATION_MUTE_DURATIONS)[number];

/** Length of each timed mute in ms; `indefinite` has none. */
export const NOTIFICATION_MUTE_DURATION_MS: Record<Exclude<NotificationMuteDuration, 'indefinite'>, number> = {
  '1h': 60 * 60 * 1000,
  '8h': 8 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

export function isNotificationMuteDuration(value: unknown): value is NotificationMuteDuration {
  return typeof value === 'string' && (NOTIFICATION_MUTE_DURATIONS as readonly string[]).includes(value);
}

/**
 * One stored notification setting of the signed-in user, for a whole space
 * (`channelId` null) or for one channel of it. Ids are the hosting
 * instance's.
 *
 * `level` null means "not chosen": a channel then inherits its space's level,
 * and a space uses `DEFAULT_NOTIFICATION_LEVEL`. `muted` with `mutedUntil`
 * null is a mute until the user lifts it; with a time, the mute ends then
 * (epoch ms, the server's clock). A mute that has ended reads as not muted.
 *
 * `updatedAt` is the server's write time. A setting with no choice left
 * (`level` null, not muted and no mass-mention suppression) is not stored,
 * and is sent as such so other
 * sessions drop theirs.
 */
export interface NotificationSetting {
  /** Space-wide suppression of mass mentions; omitted means false. Direct mentions are unaffected. */
  suppressEveryone?: boolean;
  suppressRoles?: boolean;
  spaceId: string;
  channelId: string | null;
  level: NotificationLevel | null;
  muted: boolean;
  mutedUntil: number | null;
  updatedAt: number;
}

/**
 * Body of `PATCH /api/spaces/:spaceId/notification-settings` and
 * `PATCH /api/channels/:channelId/notification-settings`. An absent field is
 * left as it is. `level: null` clears the choice (inherit / default);
 * `mute: null` lifts the mute.
 */
export interface UpdateNotificationSettingRequest {
  /** Only accepted for space settings, not channel overrides. */
  suppressEveryone?: boolean;
  suppressRoles?: boolean;
  level?: NotificationLevel | null;
  mute?: NotificationMuteDuration | null;
}

export interface NotificationSettingsResponse {
  settings: NotificationSetting[];
}

/** Whether a stored mute is in force at `now`. */
export function isMuteActive(setting: Pick<NotificationSetting, 'muted' | 'mutedUntil'> | null | undefined, now: number): boolean {
  if (!setting || !setting.muted) return false;
  return setting.mutedUntil === null || setting.mutedUntil > now;
}

/** Where a channel's effective level came from. */
export type NotificationLevelSource = 'channel' | 'space' | 'default';

/**
 * What applies to one space channel: its level after inheritance, and
 * whether it is muted (its own mute or its space's). `mutedUntil` is the
 * end of the mute in force (null while indefinite or not muted); with both
 * the channel and the space muted it is the later of the two ends.
 */
export interface ChannelNotificationPolicy {
  suppressEveryone: boolean;
  suppressRoles: boolean;
  level: NotificationLevel;
  levelSource: NotificationLevelSource;
  muted: boolean;
  mutedUntil: number | null;
  /** The channel's own mute is in force (as opposed to only the space's). */
  channelMuted: boolean;
  /** The space's mute is in force. */
  spaceMuted: boolean;
}

/**
 * The inheritance rule, in one place: a channel's own level wins, else its
 * space's, else `DEFAULT_NOTIFICATION_LEVEL`. A channel is muted while its
 * own mute or its space's is in force.
 */
export function resolveChannelNotificationPolicy(
  spaceSetting: NotificationSetting | null | undefined,
  channelSetting: NotificationSetting | null | undefined,
  now: number,
): ChannelNotificationPolicy {
  let level: NotificationLevel = DEFAULT_NOTIFICATION_LEVEL;
  let levelSource: NotificationLevelSource = 'default';
  if (channelSetting?.level) {
    level = channelSetting.level;
    levelSource = 'channel';
  } else if (spaceSetting?.level) {
    level = spaceSetting.level;
    levelSource = 'space';
  }
  const channelMuted = isMuteActive(channelSetting, now);
  const spaceMuted = isMuteActive(spaceSetting, now);
  const ends: Array<number | null> = [];
  if (channelMuted && channelSetting) ends.push(channelSetting.mutedUntil);
  if (spaceMuted && spaceSetting) ends.push(spaceSetting.mutedUntil);
  let mutedUntil: number | null = null;
  if (ends.length > 0 && !ends.includes(null)) {
    mutedUntil = Math.max(...ends.filter((end): end is number => end !== null));
  }
  return {
    level, levelSource, muted: channelMuted || spaceMuted, mutedUntil, channelMuted, spaceMuted,
    suppressEveryone: spaceSetting?.suppressEveryone === true,
    suppressRoles: spaceSetting?.suppressRoles === true,
  };
}

// ─── Message Types ──────────────────────────────────────────────────────────

export interface Message {
  id: string;
  channelId: string;
  userId: string;
  replyToId: string | null;
  content: string | null;
  type?: 'user' | 'system';
  editedAt: number | null;
  createdAt: number;
  /**
   * Space channel messages only, set by the instance hosting the space
   * (`massMentionFields` in `mentions.ts`): the content has `@everyone` or
   * `@here`, and the role ids it mentions. That instance stores a new mass
   * mention only from an author holding MENTION_EVERYONE, so a client alerts
   * on mass mentions from these fields alone. Absent from instances before
   * MENTION_EVERYONE, whose mass mentions therefore never alert.
   */
  mentionEveryone?: boolean;
  mentionRoleIds?: string[];
}

export interface MessageWithUser extends Message {
  user: User;
  attachments: Attachment[];
  embeds: Embed[];
  reactions: Reaction[];
  replyTo?: MessageWithUser | null;
}

export interface PinnedMessage {
  id: string;
  channelId: string;
  messageId: string;
  pinnedById: string | null;
  createdAt: number;
}

export interface PinWithMessage extends PinnedMessage {
  /** Null when the message row is gone but the pin lingers (deletedMessages sweep it next). */
  message: MessageWithUser | null;
}

// ─── Reaction Types ────────────────────────────────────────────────────────

export interface Reaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: number;
  user?: User;
}

// ─── Attachment Types ───────────────────────────────────────────────────────

export interface Attachment {
  id: string;
  messageId: string;
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  thumbnailFilename?: string | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  /**
   * Web-playability for video attachments. `false` = the codec can't be
   * decoded in a browser <video> (e.g. HEVC .mov) so the client renders a
   * download fallback; `true`/`null` = attempt inline playback (null is the
   * optimistic unknown case, also covered by the client's onError fallback).
   */
  playable?: boolean | null;
  createdAt: number;
}

// ─── Embed Types ──────────────────────────────────────────────────────────

export type EmbedType = 'generic' | 'video' | 'image' | 'audio' | 'rich';
export type EmbedProvider = 'youtube' | 'vimeo' | 'spotify';

export interface Embed {
  id: string;
  messageId: string | null;
  dmMessageId: string | null;
  url: string;
  embedType: EmbedType;
  provider: EmbedProvider | null;
  title: string | null;
  description: string | null;
  image: string | null;
  embedUrl: string | null;
  width: number | null;
  height: number | null;
  color: string | null;
  createdAt: number;
}

// ─── Active Call Types ───────────────────────────────────────────────────────

export interface ActiveCallInfo {
  dmChannelId: string;
  callerId: string;
  participants: string[];
  startedAt: number;
  state: 'ringing' | 'active';
}

// ─── DM Types ───────────────────────────────────────────────────────────────

export interface DmLastMessagePreview {
  id: string;
  dmChannelId: string;
  userId: string;
  content: string | null;
  createdAt: number;
  /**
   * 'system' for membership/lifecycle JSON payloads (member_added, member_removed,
   * owner_changed, space_invite). 'user' (or omitted) for normal user-authored
   * messages. The sidebar renderer relies on this to avoid showing raw JSON.
   */
  type?: 'user' | 'system';
  attachments?: Array<{ type: string; filename: string }>;
}

/**
 * A DM conversation as a current server puts it on the wire. Every field is
 * required, nullable where the row can be null, so a server payload that
 * forgets one does not compile; the server builds it only through
 * `utils/dmChannelWire.ts` (ADR 0002).
 */
export interface DmChannel {
  id: string;
  ownerId: string | null;
  createdAt: number;
  members: User[];
  lastMessage: DmLastMessagePreview | DmMessageWithUser | null;
  name: string | null;
  icon: string | null;
  metadataUpdatedAt: number;
}

export interface DmMessage {
  id: string;
  dmChannelId: string;
  userId: string;
  content: string | null;
  type?: 'user' | 'system';
  createdAt: number;
  // Compatibility fields
  channelId?: string;
  replyToId?: string | null;
  editedAt?: number | null;
}

export interface DmMessageWithUser extends DmMessage {
  user: User;
  attachments: Attachment[];
  embeds: Embed[];
  reactions: Reaction[];
  replyTo?: DmMessageWithUser | null;
}

// ─── Activity Types ────────────────────────────────────────────────────────

export type ActivityType = 'custom' | 'playing' | 'listening' | 'watching' | 'streaming';

export interface ActivityTimestamps {
  start?: number;
  end?: number;
}

/**
 * Playback progress independent of the sender's wall clock. Receivers anchor
 * this position to their own clock when the activity arrives, so devices with
 * skewed clocks still show the same elapsed playback.
 */
export interface ActivityPlayback {
  positionMs: number;
  durationMs?: number;
}

export interface ActivityAssets {
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
}

export interface Activity {
  type: ActivityType;
  name: string;
  details?: string;
  state?: string;
  timestamps?: ActivityTimestamps;
  playback?: ActivityPlayback;
  assets?: ActivityAssets;
  url?: string;
}

// ─── WebSocket Event Types ──────────────────────────────────────────────────

// Client → Server Events
export type ClientEvent =
  | { type: 'auth'; token: string; client?: ClientKind }
  | { type: 'message_create'; channelId: string; content: string; replyToId?: string }
  | { type: 'message_edit'; messageId: string; content: string }
  | { type: 'message_delete'; messageId: string }
  | { type: 'channel_poke'; channelId: string; targetUserId: string }
  | { type: 'typing_start'; channelId: string }
  | { type: 'presence_update'; status: ChosenUserStatus }
  | { type: 'voice_join'; channelId: string }
  | { type: 'voice_leave' }
  | { type: 'dm_message_create'; dmChannelId: string; content?: string; attachments?: string[]; replyToId?: string }
  | { type: 'dm_typing_start'; dmChannelId: string }
  | { type: 'dm_message_edit'; messageId: string; content: string }
  | { type: 'dm_message_delete'; messageId: string }
  | { type: 'reaction_add'; messageId: string; emoji: string }
  | { type: 'reaction_remove'; messageId: string; emoji: string }
  | { type: 'channel_ack'; channelId: string; messageId: string }
  | { type: 'mark_unread'; channelId: string; messageId: string }
  | { type: 'dm_call_start'; dmChannelId: string }
  | { type: 'dm_call_accept'; dmChannelId: string }
  | { type: 'dm_call_reject'; dmChannelId: string }
  | { type: 'dm_call_end'; dmChannelId: string }
  | { type: 'voice_status'; isMuted: boolean; isDeafened: boolean; isCameraOn: boolean; isScreenSharing: boolean }
  | { type: 'voice_space_mute'; userId: string; muted: boolean; /** For a bot seat: the channel whose seat is meant. */ channelId?: string }
  | { type: 'voice_space_deafen'; userId: string; deafened: boolean; /** For a bot seat: the channel whose seat is meant. */ channelId?: string }
  | { type: 'voice_move'; userId: string; targetChannelId: string }
  | { type: 'voice_disconnect'; userId: string; /** For a bot seat: the channel to take the bot out of. */ channelId?: string }
  | { type: 'activity_update'; activities: Activity[] }
  | { type: 'ping' };

// Server → Client Events
export type ServerEvent =
  | { type: 'soundboard_updated'; spaceId: string }
  | { type: 'soundboard_play'; channelId: string; spaceId: string; sound: import('./soundboard.js').SoundboardSound }
  | { type: 'channel_poke'; message: MessageWithUser }
  | { type: 'ready'; user: User; spaces: SpaceWithChannelsAndMembers[]; dmChannels: DmChannel[]; folders?: SpaceFolder[]; spaceLayout?: SpaceLayoutItem[] | null; layoutUpdatedAt?: number; voiceStates?: Record<string, string[]>; voiceChannelElapsedSeconds?: Record<string, number>; voiceUserStates?: Record<string, { isMuted: boolean; isDeafened: boolean; isCameraOn: boolean; isScreenSharing: boolean }>; supportsPoke?: boolean; supportsJuno?: boolean; unreadCounts?: Record<string, number>; readStates?: ReadState[]; activeCalls?: ActiveCallInfo[]; spaceVoiceStates?: Record<string, { spaceMuted: boolean; spaceDeafened: boolean; permissionMuted?: boolean }>; userActivities?: Record<string, Activity[]> }
  | { type: 'juno_updated'; channelId: string }
  | { type: 'channel_unread_count'; counts: Record<string, number> }
  | { type: 'message_created'; message: MessageWithUser }
  | { type: 'interaction_created'; interaction: BotInteraction }
  | { type: 'interaction_ephemeral'; reply: EphemeralReply }
  | { type: 'message_updated'; message: MessageWithUser }
  | { type: 'message_deleted'; messageId: string; channelId: string }
  | { type: 'message_pinned'; channelId: string; messageId: string; pinnedById: string | null }
  | { type: 'message_unpinned'; channelId: string; messageId: string }
  | { type: 'typing'; channelId: string; userId: string; username: string }
  | { type: 'presence_update'; userId: string; status: string; activities?: Activity[] }
  | { type: 'voice_state_update'; channelId: string; userId: string; action: 'join' | 'leave'; channelElapsedSeconds?: number }
  | { type: 'member_joined'; spaceId: string; member: MemberWithUser }
  | { type: 'member_updated'; spaceId: string; member: MemberWithUser }
  | { type: 'member_left'; spaceId: string; userId: string }
  | { type: 'dm_message_created'; message: DmMessageWithUser }
  | { type: 'dm_message_updated'; message: DmMessageWithUser }
  | { type: 'dm_message_deleted'; messageId: string; dmChannelId: string }
  | { type: 'dm_typing'; dmChannelId: string; userId: string; username: string }
  | { type: 'dm_typing_stop'; dmChannelId: string; userId: string }
  | { type: 'reaction_added'; messageId: string; reaction: Reaction }
  | { type: 'reaction_removed'; messageId: string; userId: string; emoji: string }
  | { type: 'channel_ack'; channelId: string; messageId: string }
  | { type: 'friend_request_received'; request: FriendRequest }
  | { type: 'friend_request_accepted'; friend: Friend; requestId: string }
  | { type: 'dm_call_incoming'; dmChannelId: string; callerId: string; callerName: string }
  // Only the authenticated answerer's other sessions stop ringing.
  | { type: 'dm_call_accepted'; dmChannelId: string; answeredByUserId: string }
  | { type: 'dm_call_rejected'; dmChannelId: string }
  | { type: 'dm_call_ended'; dmChannelId: string }
  | { type: 'voice_status_update'; userId: string; channelId: string; isMuted: boolean; isDeafened: boolean; isCameraOn: boolean; isScreenSharing: boolean }
  | { type: 'space_voice_state'; spaceId: string; voiceStates: Record<string, string[]>; voiceChannelElapsedSeconds: Record<string, number>; voiceUserStates: Record<string, { isMuted: boolean; isDeafened: boolean; isCameraOn: boolean; isScreenSharing: boolean }>; spaceVoiceStates: Record<string, { spaceMuted: boolean; spaceDeafened: boolean; permissionMuted: boolean }> }
  | { type: 'dm_channel_created'; dmChannel: DmChannel }
  | { type: 'dm_channel_closed'; dmChannelId: string }
  | { type: 'dm_channel_updated'; dmChannelId: string; name: string | null; icon: string | null }
  | { type: 'dm_member_added'; dmChannelId: string; user: User }
  | { type: 'dm_member_removed'; dmChannelId: string; userId: string }
  | { type: 'friend_removed'; userId: string }
  | { type: 'friend_request_cancelled'; requestId: string; userId: string }
  | { type: 'friend_request_declined'; requestId: string; userId: string }
  | { type: 'friend_request_sent'; request: FriendRequest }
  | { type: 'channel_created'; channel: Channel; spaceId: string }
  | { type: 'channel_updated'; channel: Channel; spaceId: string }
  | { type: 'channel_deleted'; channelId: string; spaceId: string }
  | { type: 'space_updated'; space: Space }
  | { type: 'join_request_received'; request: JoinRequest }
  | { type: 'join_request_accepted'; request: JoinRequest; space: SpaceWithChannelsAndMembers }
  | { type: 'join_request_declined'; request: JoinRequest }
  | { type: 'voice_space_muted'; userId: string; channelId: string; spaceId: string; muted: boolean; /** The restriction is this bot seat's (`channelId`) only. */ botSeat?: boolean }
  | { type: 'voice_space_deafened'; userId: string; channelId: string; spaceId: string; deafened: boolean; /** The restriction is this bot seat's (`channelId`) only. */ botSeat?: boolean }
  | { type: 'voice_permission_muted'; userId: string; spaceId: string; /** Set for a bot seat: the mute is that channel's only. */ channelId?: string; muted: boolean }
  | { type: 'voice_moved'; userId: string; oldChannelId: string; newChannelId: string }
  | { type: 'voice_disconnected'; userId: string; channelId: string; reason?: 'displaced' | 'session_closed' | 'rejected' }
  | { type: 'user_updated'; user: User }
  | { type: 'member_banned'; spaceId: string; reason: string | null }
  | { type: 'category_created'; category: ChannelCategory; spaceId: string }
  | { type: 'category_updated'; category: ChannelCategory; spaceId: string }
  | { type: 'category_deleted'; categoryId: string; spaceId: string }
  | { type: 'channel_layout_updated'; spaceId: string; channels: Channel[]; categories: ChannelCategory[] }
  | { type: 'space_layout_updated'; layout: SpaceLayoutItem[]; folders: SpaceFolder[]; updatedAt?: number }
  // One of the user's notification settings on this instance changed (from
  // any of their sessions here). A setting with level null and not muted was
  // cleared. See docs/systems/websocket.md.
  | { type: 'notification_settings_updated'; setting: NotificationSetting }
  | { type: 'mark_unread'; channelId: string; messageId: string }
  | { type: 'embeds_resolved'; messageId: string; channelId: string; embeds: Embed[] }
  | { type: 'dm_embeds_resolved'; messageId: string; dmChannelId: string; embeds: Embed[] }
  | {
      type: 'dm_owner_updated';
      dmChannelId: string;
      newOwnerId: string;
    }
  | { type: 'pong' }
  // `code` is set where the refusal has a stable ErrorCode (e.g. a voice
  // moderation action refused by the role hierarchy); older senders omit it.
  // `details` fills the code's placeholders (`content_too_long` carries
  // `max`), as in an HTTP error body. `dmChannelId` names the call of a refused `dm_call_start` or
  // `dm_call_accept`; a client calling or in that call drops it (voice.md,
  // "DM Call State Machine").
  | { type: 'error'; message: string; code?: ErrorCode; details?: ErrorDetails; dmChannelId?: string; retryAfter?: number }
  // The space's roles or a member's roles changed: what the receiver may see
  // or do there, and how its roles and members look, may be different now.
  // The client refetches that space's detail (docs/systems/websocket.md).
  | { type: 'space_access_changed'; spaceId: string }
  | { type: 'instance_settings_updated'; spaceCreationOpen: boolean };

// ─── API Request/Response Types ─────────────────────────────────────────────

export interface RegisterRequest {
  username: string;
  password: string;
  displayName?: string;
  avatarColor?: string;
  inviteToken?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface CreateSpaceRequest {
  name: string;
  icon?: string;
  banner?: string;
  avatarColor?: string;
  visibility?: SpaceVisibility;
  description?: string;
}

export interface CreateChannelRequest {
  name: string;
  type: ChannelType;
  topic?: string;
  categoryId?: string;
}

export interface UpdateChannelRequest {
  name?: string;
  /** `null` or a value that trims to nothing clears the topic. */
  topic?: string | null;
  position?: number;
  categoryId?: string | null;
}

export interface UpdateSpaceRequest {
  ownerTitle?: string | null;
  name?: string;
  icon?: string;
  banner?: string;
  avatarColor?: string;
  visibility?: SpaceVisibility;
  description?: string;
  /** Voice channel id for idle moves, or null to disable. Must be a voice channel of this space. */
  afkChannelId?: string | null;
  /** One of AFK_TIMEOUT_OPTIONS. Ignored unless afkChannelId is set. */
  afkTimeoutSeconds?: number;
}

export interface UpdateUserRequest {
  displayName?: string;
  avatar?: string;
  banner?: string;
  accentColor?: string;
  avatarColor?: string;
  bio?: string;
  customStatus?: string;
  status?: ChosenUserStatus;
  discoverable?: boolean;
  showActivity?: boolean;
  developerMode?: boolean;
}

export interface UpdateMemberRequest {
  roleIds?: string[];
  /** Space-local name; null explicitly restores the account display name. */
  nickname?: string | null;
}

export interface CreateMessageRequest {
  content: string;
  attachments?: string[];
  replyToId?: string;
}

export interface UpdateMessageRequest {
  content: string;
}

export interface JoinSpaceRequest {
  inviteCode: string;
}

export interface LiveKitTokenRequest {
  channelId: string;
}

export interface LiveKitTokenResponse {
  token: string;
  url: string;
}

export interface CreateDmRequest {
  userId: string;
}

export interface AddDmMemberRequest {
  userId: string;
}

/**
 * Body of POST /api/dm/:id/transfer.
 *
 * The authenticated owner names another existing local group member.
 */
export interface TransferOwnershipRequest {
  newOwnerId: string;
}

export interface GroupDmUserIdentity {
  id: string;
}

export interface CreateGroupDmRequest {
  users: GroupDmUserIdentity[];
  fromDmChannelId?: string;
}

export interface CreateDmMessageRequest {
  content?: string;
  attachments?: string[];
  replyToId?: string;
}

// ─── Space Invite via DM ────────────────────────────────────────────────────

export interface SpaceInviteRequest {
  /** Existing friend on the current instance. */
  target: { userId: string };
  /** Local space identifier. */
  spaceId: string;
  /** Current instance origin, or empty. A foreign host is refused, not stripped. */
  spaceInstanceOrigin: string;
  /** Per-space invite code (already issued; client passes whatever it has loaded). */
  inviteCode: string;
}

export interface SpaceInviteResponse {
  dmChannelId: string;
  messageId: string;
  message: DmMessageWithUser;
}

/** JSON content shape for type='system' space_invite messages. */
export interface SpaceInviteSystemPayload {
  event: 'space_invite';
  spaceId: string;
  spaceInstanceOrigin: string;
  inviteCode: string;
  snapshot: {
    spaceName: string;
    icon: string | null;
    avatarColor: AvatarColor | null;
    memberCount: number;
    description: string | null;
    instanceName: string;
  };
}

export interface PaginatedQuery {
  before?: string;
  after?: string;
  limit?: number;
}

/**
 * Set by the message history endpoints on a response that honoured `after`.
 * A server that predates forward paging ignores `after` and answers with the
 * newest page, without this header. Contract: docs/systems/api.md, "Message
 * history paging".
 */
export const MESSAGE_PAGING_HEADER = 'X-Backspace-Paging';
export const MESSAGE_PAGING_AFTER = 'after';

export interface ApiError {
  error: string;
  statusCode: number;
}

// ─── Social Types ────────────────────────────────────────────────────────────

export interface Friend {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  banner: string | null;
  accentColor: string | null;
  avatarColor: AvatarColor | null;
  bio: string | null;
  status: UserStatus;
  customStatus: string | null;
  createdAt: number;
  addedAt: number;
  isBot?: boolean;
}

export interface DiscoverUser {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  banner: string | null;
  avatarColor: AvatarColor | null;
  bio: string | null;
  status: UserStatus;
  customStatus: string | null;
  createdAt: number;
  mutualFriendCount: number;
  mutualSpaceCount: number;
  relationship: 'none' | 'friends' | 'outbound_pending' | 'inbound_pending';
  isBot?: boolean;
  requestId?: string;
}

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined';

export interface FriendRequest {
  id: string;
  fromId: string;
  toId: string;
  status: FriendRequestStatus;
  createdAt: number;
  user?: User; // The other user (if it's an incoming request, the sender; if outgoing, the recipient)
}

/** Exact username of an existing account on the current instance. */
export interface SendFriendRequest {
  username: string;
}

export interface UpdateFriendRequest {
  status: 'accepted' | 'declined';
}

// ─── GIF Types ──────────────────────────────────────────────────────────────

export interface GifResult {
  id: string;
  title: string;
  previewUrl: string;
  url: string;
  width: number;
  height: number;
}

// ─── Instance Settings Types ────────────────────────────────────────────────

export interface InstanceAdminSettings {
  instanceName: string;
  registrationOpen: boolean;
  spaceCreationOpen: boolean;
  gifApiKey?: string;
  gifEnabled?: boolean;
  maxUploadSizeMb: number;
  maxStickerSizeMb: number;
}

export interface InstanceStreamingLimits {
  maxBitrateKbps: number;
  minBitrateKbps: number;
  bitrateStepKbps: number;
  allowedResolutions: (number | 'native')[];
  allowedFramerates: number[];
  maxResolution: number;
  maxFramerate: number;
  bitrateMatrixOverrides: Record<string, number> | null;
  allowCustomBitrate: boolean;
}

// ─── Current Instance Info ─────────────────────────────────────────────────

export interface InstanceInfoResponse {
  name: string;
  version: string;
  registrationOpen: boolean;
  spaceCreationOpen: boolean;
  // AGPL-3.0 § 13 network-use source offer: URL to the Corresponding Source of
  // the version this instance is running (operator-configurable via
  // BACKSPACE_SOURCE_URL so forks point at their own source).
  sourceCodeUrl: string;
  // Short git SHA/tag of the running build; null in dev builds with no commit injected.
  commit: string | null;
  /**
   * Maximum custom sticker / emoji upload size in megabytes.
   */
  maxStickerSizeMb?: number;
}

/**
 * What the admin Updates panel renders. Admin-only.
 *
 * `state` is deliberately three-valued. An instance with no outbound internet,
 * or one whose operator turned the lookup off, must be able to say "I do not
 * know" instead of implying it is current.
 */
export interface InstanceUpdateStatus {
  current: {
    version: string;
    /** Short git SHA baked at build time; null in dev builds. */
    commit: string | null;
  };
  latest: {
    version: string;
    url: string;
    /** ISO 8601, or an empty string when the release carried no date. */
    publishedAt: string;
  } | null;
  state: 'up-to-date' | 'update-available' | 'unknown';
  /** Epoch ms of the lookup this answer came from; null when none was made. */
  checkedAt: number | null;
  /** False when BACKSPACE_UPDATE_CHECK=false. */
  checkEnabled: boolean;
  /** Why `state` is unknown, when it is. Null otherwise. */
  reason: 'disabled' | 'unreachable' | 'rate-limited' | 'unparseable' | null;
  /**
   * How this instance gets its image. `unknown` on installs that predate
   * install.sh recording it, which the panel handles by showing both sets of
   * manual commands rather than guessing.
   */
  channel: 'prebuilt' | 'source' | 'unknown';
}

export interface VerifyPasswordRequest {
  password: string;
}

export interface VerifyPasswordResponse {
  valid: boolean;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ChangePasswordResponse {
  token: string;
}

export interface DeleteAccountRequest {
  password: string;
  username: string;  // Must match — confirmation safeguard
}

// ─── Storage Management Types ─────────────────────────────────────────────

export interface StorageBreakdown {
  type: string;   // 'image' | 'video' | 'audio' | 'document' | 'other'
  count: number;
  size: number;
}

export interface StorageStats {
  totalFiles: number;
  totalSize: number;
  referencedFiles: number;
  referencedSize: number;
  orphanedFiles: number;
  orphanedSize: number;
  unlinkedAttachments: number;
  unlinkedSize: number;
  danglingAttachments: number;
  danglingSize: number;
  /** Count of `.tus/` entries (payloads + sidecars) with mtime older than 1h. */
  staleTusSessions: number;
  /** Total size in bytes of those stale `.tus/` entries. */
  staleTusSize: number;
  breakdown: StorageBreakdown[];
}

export interface OrphanedFile {
  filename: string;
  size: number;
  modifiedAt: number;
}

export interface CleanupResult {
  dryRun: boolean;
  deletedFiles: number;
  freedBytes: number;
  deletedAttachmentRecords: number;
  errors: string[];
}

// ─── Admin User Management Types ──────────────────────────────────────────

export interface AdminUser {
  isBot: boolean;
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  avatarColor: string | null;
  status: string;
  isAdmin: boolean;
  isDeleted: boolean;
  createdAt: number;
}

export interface AdminUserListResponse {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminResetPasswordResponse {
  temporaryPassword: string;
}

// ─── Invite Links ──────────────────────────────────────────────────────────

/** Derived status of an invite link. Active = usable; expired/exhausted/revoked = archived. */
export type InviteStatus = 'active' | 'expired' | 'exhausted' | 'revoked';

export interface InviteLinkSummary {
  id: string;
  token: string;
  name: string;
  status: InviteStatus;
  maxUses: number | null;
  usedCount: number;
  expiresAt: number | null;
  revokedAt: number | null;
  createdBy: string;
  /** Joined from users.username at read time. `'Deleted User'` when the creator's account is tombstoned. `null` only if the FK is somehow unresolvable (defensive). */
  createdByUsername: string | null;
  createdAt: number;
  /** Epoch ms of the most recent redemption; `null` when the invite has zero redemptions. */
  lastRedeemedAt: number | null;
  /** Server-constructed full URL, e.g. `https://host.example/register?invite=<token>`. Clients must NOT assemble this themselves. */
  url: string;
}

export interface InviteRedemption {
  id: string;
  userId: string | null;
  registrantUsername: string;
  currentUsername: string | null;
  isDeleted: boolean;
  redeemedAt: number;
}

export interface CreateInviteRequest {
  name: string;
  maxUses: number | null;
  expiresAt: number | null;
}

export interface UpdateInviteRequest {
  name?: string;
  maxUses?: number | null;
  expiresAt?: number | null;
}

export interface ReinstateInviteRequest {
  maxUses?: number | null;
  expiresAt?: number | null;
}

export interface ReinstateInviteResponse {
  invite: InviteLinkSummary;
  tokenRotated: boolean;
}

export interface CheckInviteValidResponse {
  valid: true;
  name: string;
}

export interface CheckInviteInvalidResponse {
  valid: false;
  reason: 'expired' | 'exhausted' | 'invalid';
}

export type CheckInviteResponse = CheckInviteValidResponse | CheckInviteInvalidResponse;

export type ClientKind = 'web' | 'desktop' | 'mobile';

/** A bot status kind the owner can store (`BOT_ACTIVITY_TYPES`). */
export type BotActivityType = 'custom' | 'playing' | 'listening' | 'watching';

/**
 * The status an owner stores for a bot. Shown as the bot's live activity while
 * it is connected; the bot's own `activity_update` replaces it until the bot's
 * next connection. `name` is 1–128 characters after trim.
 */
export interface BotActivity {
  type: BotActivityType;
  name: string;
}

export interface BotSummary {
  id: string;
  username: string;
  displayName: string | null;
  avatarColor: string | null;
  avatar: string | null;
  /** "About": the bot's profile bio. */
  bio: string | null;
  /** The stored status, or null for none. */
  activity: BotActivity | null;
  /**
   * The space permissions the bot asks for, a permission bitmask as a decimal
   * string ('0' for none). A manager adding the bot grants any subset of it.
   */
  requestedPermissions: string;
  createdAt: number;
}

/** One access token of a bot, as the owner lists it. The secret is never listed. */
export interface BotTokenSummary {
  id: string;
  /** The owner's label, or null. */
  name: string | null;
  createdAt: number;
  /** Updated at most once a minute; null while never used. */
  lastUsedAt: number | null;
}

export interface BotTokensResponse {
  tokens: BotTokenSummary[];
  /** True while the bot still runs on its old 10-year token and holds no new one. */
  legacy: boolean;
}

export interface CreateBotTokenRequest {
  /** Optional label, 1-32 characters after trim. */
  name?: string;
}

/** `token` is the only time the secret is shown. */
export interface CreateBotTokenResponse extends BotTokenSummary {
  token: string;
}

/** A bot as the invite search lists it: the owner is named so a manager sees whose code they invite. */
export interface BotSearchResult extends BotSummary {
  /** The owner's username; null when the owner is deleted or not discoverable. */
  ownerUsername: string | null;
}

export interface UpdateBotRequest {
  /** 1–32 characters after trim. The login (username) is immutable. */
  displayName?: string;
  /** Bare filename from an upload, or null to clear. */
  avatar?: string | null;
  /** Up to `PROFILE_BIO_MAX_LENGTH` characters after trim; null or blank clears. */
  bio?: string | null;
  /** The stored status; null clears. Takes effect at once while the bot is connected. */
  activity?: BotActivity | null;
  /** Requested space permissions: a canonical decimal bitmask of defined bits; '0' for none. */
  requestedPermissions?: string;
}

/** POST /api/bots/:id/spaces. */
export interface AddBotToSpaceRequest {
  spaceId: string;
  /**
   * The permissions the manager grants, a decimal bitmask within the bot's
   * requested permissions and the manager's own. Omitted: every requested bit
   * the manager holds. '0' or nothing to grant: no role is created.
   */
  permissions?: string;
}

export interface UpdateBotResponse {
  bot: BotSummary;
}

export interface BotSpaceOption {
  id: string;
  name: string;
  icon: string | null;
  /** Whether the bot is already a member. */
  botIsMember: boolean;
}

export interface BotSpacesResponse {
  spaces: BotSpaceOption[];
}

export interface CreateBotRequest {
  name: string;
}

export interface CreateBotResponse {
  bot: BotSummary;
  /** Shown once; never stored in readable form. */
  token: string;
}

export interface RegenerateBotTokenResponse {
  token: string;
}

/**
 * The value types of a slash command option. `user`, `channel` and `role` take
 * an id; the bot also gets the named object in `BotInteraction.resolved`.
 */
export type BotCommandValueType = 'string' | 'integer' | 'number' | 'boolean' | 'user' | 'channel' | 'role';

/**
 * The types of a command's options: a value type, or a step of a command's
 * path. A `subcommand` holds value options of its own; a `subcommand_group`
 * holds subcommands. A command, or a group, lists either steps or values,
 * never both, so a path is at most two words (`/music queue add`).
 */
export type BotCommandOptionType = BotCommandValueType | 'subcommand' | 'subcommand_group';

export interface BotCommandChoice {
  name: string;
  value: string | number;
}

export interface BotCommandOption {
  name: string;
  description: string;
  type: BotCommandOptionType;
  required: boolean;
  /**
   * Static choices (string, integer and number options only), at most 25. The
   * message box offers them by name; any other value of the option's type is
   * accepted too, unless `strictChoices` is set.
   */
  choices?: BotCommandChoice[];
  /** With `choices`: only a listed value is accepted. */
  strictChoices?: boolean;
  /** Integer and number options without choices: the smallest and largest value accepted. */
  minValue?: number;
  maxValue?: number;
  /** String options without choices: the shortest and longest value accepted (0 to 2000, default 1 to 2000). */
  minLength?: number;
  maxLength?: number;
  /** Channel options: the channel types accepted; absent means every type. */
  channelTypes?: ChannelType[];
  /**
   * A `subcommand`'s value options, or a `subcommand_group`'s subcommands.
   * Absent on value options; a subcommand without options has none.
   */
  options?: BotCommandOption[];
  /**
   * Subcommands and groups only: permissions needed, on top of the command's
   * own, to see and use this step (canonical decimal mask). Absent for none.
   */
  requiredPermissions?: string;
}

/**
 * Permissions a bot asks of the people who use a command or a step of it: a
 * canonical decimal mask (`"2048"`) or a list of permission names
 * (`["MANAGE_MESSAGES"]`). The server stores and hands back the mask.
 */
export type BotCommandPermissionsDefinition = string | string[];

/** An option as a bot registers it: `required` may be left out (false); subcommands never have it. */
export type BotCommandOptionDefinition = Omit<BotCommandOption, 'required' | 'options' | 'requiredPermissions'> & {
  required?: boolean;
  options?: BotCommandOptionDefinition[];
  requiredPermissions?: BotCommandPermissionsDefinition;
};

/** What a bot sends when registering a command. */
export interface BotCommandDefinition {
  name: string;
  description: string;
  options?: BotCommandOptionDefinition[];
  /**
   * Permissions a person needs in the channel to see and use the command;
   * such a command is hidden from and refused in direct messages.
   */
  requiredPermissions?: BotCommandPermissionsDefinition;
}

export interface BotCommand {
  id: string;
  botId: string;
  name: string;
  description: string;
  options: BotCommandOption[];
  /** The permissions needed to see and use the command (canonical decimal mask); absent for none. */
  requiredPermissions?: string;
  updatedAt: number;
}

export interface SetBotCommandsRequest {
  commands: BotCommandDefinition[];
}

export interface BotCommandsResponse {
  commands: BotCommand[];
}

export type BotInteractionOptionValue = string | number | boolean;

/** A channel named by a `channel` option, as the bot receives it. */
export interface BotResolvedChannel {
  id: string;
  spaceId: string;
  name: string;
  type: ChannelType;
}

/**
 * The objects the `user`, `channel` and `role` options of an interaction name,
 * keyed by id; only the kinds the interaction uses are present.
 */
export interface BotInteractionResolved {
  users?: Record<string, User>;
  channels?: Record<string, BotResolvedChannel>;
  /** Display fields only: a role's permission bits are not handed out. */
  roles?: Record<string, Role>;
}

/** The event a bot receives when a user invokes one of its slash commands. */
export interface BotInteraction {
  id: string;
  command: string;
  /**
   * For a command with subcommands: the path invoked, a subcommand
   * (`["play"]`) or a group and its subcommand (`["queue", "add"]`).
   * `options` are that subcommand's. Absent for a command without subcommands.
   */
  subcommand?: string[];
  options: Record<string, BotInteractionOptionValue>;
  /** Objects named by `user`, `channel` and `role` options; absent when there are none. */
  resolved?: BotInteractionResolved;
  user: User;
  /** Set for a space channel. */
  channelId?: string;
  spaceId?: string;
  /** Set for a direct or group DM. */
  dmChannelId?: string;
  expiresAt: number;
}

export interface CreateInteractionRequest {
  botId: string;
  command: string;
  /** Required for a command with subcommands, refused for one without: the path to a subcommand. */
  subcommand?: string[];
  options?: Record<string, BotInteractionOptionValue>;
  /** Exactly one of channelId and dmChannelId. */
  channelId?: string;
  dmChannelId?: string;
}

export interface CreateInteractionResponse {
  id: string;
  expiresAt: number;
}

export interface RespondToInteractionRequest {
  content?: string;
  attachments?: string[];
  /**
   * Shown only to the person who invoked the command, and not stored: text
   * only (no attachments), gone when they reload or dismiss it.
   */
  ephemeral?: boolean;
}

/**
 * A bot's answer to a slash command that only the person who invoked it sees
 * (`ephemeral: true`). It is never stored: it reaches that person's open
 * sessions as `interaction_ephemeral` and lives in their client until they
 * reload or dismiss it.
 */
export interface EphemeralReply {
  /** Unique per reply; not a message id. */
  id: string;
  interactionId: string;
  /** The name of the command it answers. */
  command: string;
  /** The bot. */
  user: User;
  content: string;
  createdAt: number;
  /** The chat it was invoked in: a space channel, or a direct or group DM. */
  channelId?: string;
  spaceId?: string;
  dmChannelId?: string;
}

export interface BotCommandListing extends BotCommand {
  bot: {
    id: string;
    username: string;
    displayName: string | null;
    avatar: string | null;
    avatarColor: string | null;
  };
}

export interface ChatCommandsResponse {
  commands: BotCommandListing[];
}

export type { DmSystemEvent } from './dmSystemEvents.js';
export type { ChannelSystemEvent } from './channelSystemEvents.js';
