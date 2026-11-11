import { sqliteTable, text, integer, primaryKey, foreignKey, real, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').unique().notNull(),
  displayName: text('display_name'),
  passwordHash: text('password_hash').notNull(),
  avatar: text('avatar'),
  /** Live presence: the chosen status while connected, 'offline' with no connection. */
  status: text('status').default('offline'),
  /**
   * The status the user picked ('online' | 'idle' | 'dnd'). Survives disconnects
   * and restarts; published as `status` when a connection authenticates.
   */
  chosenStatus: text('chosen_status').notNull().default('online'),
  customStatus: text('custom_status'),
  isAdmin: integer('is_admin').default(0),
  banner: text('banner'),
  accentColor: text('accent_color'),
  avatarColor: text('avatar_color'),
  bio: text('bio'),
  isDeleted: integer('is_deleted').default(0),
  discoverable: integer('discoverable').default(1),
  profileUpdatedAt: integer('profile_updated_at'),
  passwordChangedAt: integer('password_changed_at'),
  showActivity: integer('show_activity').notNull().default(1),
  /** 1 = the account turned Developer Mode on: shows the Bots tab in its settings. Self-view only. */
  developerMode: integer('developer_mode').notNull().default(0),
  /** 1 = bot account: no password login, authenticates with an owner-issued token. */
  isBot: integer('is_bot').notNull().default(0),
  /** users.id of the human who created the bot. No FK: tombstoneUser keeps the row. */
  botOwnerId: text('bot_owner_id'),
  /**
   * A bot's stored status, JSON `{ type, name }` (`BotActivity`), or null. Set
   * by the owner. Applied as
   * the bot's live activity when it connects (ws/botActivity.ts).
   */
  botActivity: text('bot_activity'),
  /**
   * A bot's requested space permissions: a permission bitmask as a canonical
   * decimal string, null or '0' for none. Set by the owner. A manager
   * adding the bot to a space grants any subset of it through the bot's
   * managed role (`roles.managed_bot_id`).
   */
  botRequestedPermissions: text('bot_requested_permissions'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  botOwnerIdx: index('idx_users_bot_owner_id').on(table.botOwnerId),
}));

export const spaces = sqliteTable('spaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon'),
  banner: text('banner'),
  avatarColor: text('avatar_color'),
  ownerId: text('owner_id').notNull().references(() => users.id),
  ownerTitle: text('owner_title'),
  inviteCode: text('invite_code').unique(),
  visibility: text('visibility').default('private'),
  description: text('description'),
  afkChannelId: text('afk_channel_id'),
  afkTimeoutSeconds: integer('afk_timeout_seconds').notNull().default(300),
  createdAt: integer('created_at').notNull(),
});

export const soundboardSettings = sqliteTable('soundboard_settings', {
  spaceId: text('space_id').primaryKey().references(() => spaces.id, { onDelete: 'cascade' }),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  allowMemberUploads: integer('allow_member_uploads', { mode: 'boolean' }).notNull().default(true),
  maxDurationSeconds: real('max_duration_seconds').notNull().default(30),
  maxSounds: integer('max_sounds').notNull().default(100),
});

export const soundboardSounds = sqliteTable('soundboard_sounds', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  uploaderId: text('uploader_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  emoji: text('emoji').notNull(),
  filename: text('filename').notNull(),
  durationSeconds: real('duration_seconds').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => ({ spaceIdx: index('idx_soundboard_sounds_space_id').on(table.spaceId) }));

export const spaceMembers = sqliteTable('space_members', {
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  nickname: text('nickname'),
  joinedAt: integer('joined_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.spaceId, table.userId] }),
  userIdx: index('idx_space_members_user_id').on(table.userId),
}));

export const channelCategories = sqliteTable('channel_categories', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  position: integer('position').default(0),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  spaceIdx: index('idx_channel_categories_space_id').on(table.spaceId),
}));

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull(),
  topic: text('topic'),
  position: integer('position').default(0),
  categoryId: text('category_id'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  spaceIdx: index('idx_channels_space_id').on(table.spaceId),
}));

export const junoRoundResults = sqliteTable('juno_round_results', {
  roundId: text('round_id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  channelId: text('channel_id').references(() => channels.id, { onDelete: 'set null' }),
  finishedAt: integer('finished_at').notNull(),
  scoringVersion: integer('scoring_version').notNull(),
}, table => ({ spaceIdx: index('idx_juno_results_space').on(table.spaceId) }));

export const junoRoundParticipants = sqliteTable('juno_round_participants', {
  roundId: text('round_id').notNull().references(() => junoRoundResults.roundId, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  place: integer('place').$type<1 | 2 | 3 | 4>(),
  cardCount: integer('card_count'),
  xp: integer('xp').notNull(),
  outcome: text('outcome', { enum: ['completed', 'abandoned', 'unranked'] }).notNull(),
}, table => ({
  pk: primaryKey({ columns: [table.roundId, table.userId] }),
  userIdx: index('idx_juno_participants_user').on(table.userId),
  nonnegative: check('juno_participant_nonnegative', sql`${table.xp} >= 0 AND (${table.cardCount} IS NULL OR ${table.cardCount} >= 0)`),
}));

export const junoPlayerStats = sqliteTable('juno_player_stats', {
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  totalXp: integer('total_xp').notNull().default(0),
  wins: integer('wins').notNull().default(0),
  completedRounds: integer('completed_rounds').notNull().default(0),
}, table => ({
  pk: primaryKey({ columns: [table.spaceId, table.userId] }),
  rankIdx: index('idx_juno_stats_ranking').on(table.spaceId, table.totalXp, table.wins, table.userId),
  userIdx: index('idx_juno_stats_user').on(table.userId),
  nonnegative: check('juno_stats_nonnegative', sql`${table.totalXp} >= 0 AND ${table.wins} >= 0 AND ${table.completedRounds} >= ${table.wins}`),
}));

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id),
  replyToId: text('reply_to_id'),
  content: text('content'),
  type: text('type', { enum: ['user', 'system'] }).notNull().default('user'),
  editedAt: integer('edited_at'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  replyToFk: foreignKey({
    columns: [table.replyToId],
    foreignColumns: [table.id],
  }).onDelete('set null'),
  channelIdx: index('idx_messages_channel_id').on(table.channelId),
  userIdx: index('idx_messages_user_id').on(table.userId),
  // Unread counts (ws/channelUnreadCounts.ts): the messages of a channel after
  // a read cursor, compared as numbers, with the author to leave out the
  // reader's own and the type to leave out system rows, so a count reads the
  // index alone. The expression is unqualified because SQLite refuses a
  // qualified column in an index expression, and the query must spell it
  // `CAST(... AS INTEGER)` in this case for the planner to match it.
  unreadIdx: index('idx_messages_channel_unread').on(table.channelId, sql`CAST(id AS INTEGER)`, table.userId, table.type),
}));

export const pinnedMessages = sqliteTable('pinned_messages', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  pinnedById: text('pinned_by_id'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  channelIdx: index('idx_pinned_messages_channel').on(table.channelId),
  messageUnique: uniqueIndex('idx_pinned_messages_message').on(table.messageId),
}));

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  dmMessageId: text('dm_message_id').references(() => dmMessages.id, { onDelete: 'cascade' }),
  uploaderId: text('uploader_id'),
  filename: text('filename').notNull(),
  originalName: text('original_name').notNull(),
  mimetype: text('mimetype').notNull(),
  size: integer('size').notNull(),
  thumbnailFilename: text('thumbnail_filename'),
  width: integer('width'),
  height: integer('height'),
  duration: real('duration'),
  // Tri-state web-playability for video attachments: 1 = decodable in a
  // browser <video>, 0 = known-undecodable (e.g. HEVC .mov), NULL = unknown
  // (codec unprobed / non-video). Drives the client's download fallback.
  playable: integer('playable', { mode: 'boolean' }),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  messageIdx: index('idx_attachments_message_id').on(table.messageId),
  dmMessageIdx: index('idx_attachments_dm_message_id').on(table.dmMessageId),
}));

export const embeds = sqliteTable('embeds', {
  id: text('id').primaryKey(),
  messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  dmMessageId: text('dm_message_id').references(() => dmMessages.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  embedType: text('embed_type').notNull(),
  provider: text('provider'),
  title: text('title'),
  description: text('description'),
  image: text('image'),
  embedUrl: text('embed_url'),
  width: integer('width'),
  height: integer('height'),
  color: text('color'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  messageIdx: index('idx_embeds_message_id').on(table.messageId),
  dmMessageIdx: index('idx_embeds_dm_message_id').on(table.dmMessageId),
}));

export const dmChannels = sqliteTable('dm_channels', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id'),
  /** Private uniqueness key for the two local participants; never serialized. */
  pairKey: text('pair_key'),
  deletedAt: integer('deleted_at'),
  createdAt: integer('created_at').notNull(),
  name: text('name'),
  icon: text('icon'),
  metadataUpdatedAt: integer('metadata_updated_at').default(0).notNull(),
}, (table) => ({
  pairIdx: uniqueIndex('idx_dm_pair_key')
    .on(table.pairKey)
    .where(sql`pair_key IS NOT NULL`),
}));

export const dmMembers = sqliteTable('dm_members', {
  dmChannelId: text('dm_channel_id').notNull().references(() => dmChannels.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  closed: integer('closed').default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.dmChannelId, table.userId] }),
  userIdx: index('idx_dm_members_user_id').on(table.userId),
}));

export const dmMessages = sqliteTable('dm_messages', {
  id: text('id').primaryKey(),
  dmChannelId: text('dm_channel_id').notNull().references(() => dmChannels.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id),
  replyToId: text('reply_to_id'),
  content: text('content'),
  type: text('type').notNull().default('user'),
  editedAt: integer('edited_at'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  replyToFk: foreignKey({
    columns: [table.replyToId],
    foreignColumns: [table.id],
  }).onDelete('set null'),
  channelIdx: index('idx_dm_messages_dm_channel_id').on(table.dmChannelId),
  userIdx: index('idx_dm_messages_user_id').on(table.userId),
  // Unread counts, as idx_messages_channel_unread above.
  unreadIdx: index('idx_dm_messages_channel_unread').on(table.dmChannelId, sql`CAST(id AS INTEGER)`, table.userId),
}));

export const friends = sqliteTable('friends', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  friendId: text('friend_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.friendId] }),
  userIdx: index('idx_friends_user_id').on(table.userId),
  friendIdx: index('idx_friends_friend_id').on(table.friendId),
}));

export const friendRequests = sqliteTable('friend_requests', {
  id: text('id').primaryKey(),
  fromId: text('from_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  toId: text('to_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').default('pending'), // 'pending', 'accepted', 'declined'
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  toIdx: index('idx_friend_requests_to_id').on(table.toId),
  fromIdx: index('idx_friend_requests_from_id').on(table.fromId),
}));

export const reactions = sqliteTable('reactions', {
  id: text('id').primaryKey(),
  messageId: text('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji: text('emoji').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  messageIdx: index('idx_reactions_message_id').on(table.messageId),
  // One reaction per user, emoji and message. A repeat insert is refused.
  messageUserEmojiIdx: uniqueIndex('idx_reactions_message_user_emoji').on(table.messageId, table.userId, table.emoji),
}));

export const dmReactions = sqliteTable('dm_reactions', {
  id: text('id').primaryKey(),
  dmMessageId: text('dm_message_id').notNull().references(() => dmMessages.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji: text('emoji').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  dmMessageIdx: index('idx_dm_reactions_dm_message_id').on(table.dmMessageId),
  // One reaction per user, emoji and message. A repeat insert is refused.
  dmMessageUserEmojiIdx: uniqueIndex('idx_dm_reactions_message_user_emoji').on(table.dmMessageId, table.userId, table.emoji),
}));

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').default('#b9bbbe'),
  position: integer('position').default(0),
  permissions: text('permissions'), // JSON string of permission keys
  createdAt: integer('created_at').notNull(),
  /**
   * Set on a bot's managed role: the bot (users.id) the role was created for
   * when it was added to the space. Only that bot holds it; it cannot be
   * deleted or given to anyone else, and it goes when the bot leaves the
   * space (utils/botRoles.ts). No FK: tombstoneUser keeps the user row.
   */
  managedBotId: text('managed_bot_id'),
}, (table) => ({
  spaceIdx: index('idx_roles_space_id').on(table.spaceId),
  managedBotIdx: uniqueIndex('idx_roles_managed_bot').on(table.spaceId, table.managedBotId),
}));

export const memberRoles = sqliteTable('member_roles', {
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.spaceId, table.userId, table.roleId] }),
  userSpaceIdx: index('idx_member_roles_user_id_space_id').on(table.userId, table.spaceId),
}));

export const channelOverrides = sqliteTable('channel_overrides', {
  channelId: text('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  targetType: text('target_type').notNull(), // 'role' | 'member'
  targetId: text('target_id').notNull(), // role ID or user ID
  allow: text('allow').notNull().default('0'), // BigInt decimal string
  deny: text('deny').notNull().default('0'), // BigInt decimal string
}, (table) => ({
  pk: primaryKey({ columns: [table.channelId, table.targetType, table.targetId] }),
  channelIdx: index('idx_channel_overrides_channel_id').on(table.channelId),
}));

export const categoryOverrides = sqliteTable('category_overrides', {
  categoryId: text('category_id').notNull().references(() => channelCategories.id, { onDelete: 'cascade' }),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  allow: text('allow').notNull().default('0'),
  deny: text('deny').notNull().default('0'),
}, (table) => ({
  pk: primaryKey({ columns: [table.categoryId, table.targetType, table.targetId] }),
  categoryIdx: index('idx_category_overrides_category_id').on(table.categoryId),
}));

export const readStates = sqliteTable('read_states', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channelId: text('channel_id').notNull(),
  lastReadMessageId: text('last_read_message_id').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.channelId] }),
  userIdx: index('idx_read_states_user_id').on(table.userId),
}));

/**
 * A user's notification setting for a space (`channel_id` NULL) or for one
 * channel of it. Keyed by the user's local row. `level` NULL is "not chosen": the channel inherits the space,
 * the space uses the default. `muted` with `muted_until` NULL lasts until
 * lifted. A row with no choice left is deleted, not kept.
 * See docs/systems/sounds.md ("Notification settings").
 */
export const notificationSettings = sqliteTable('notification_settings', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  channelId: text('channel_id').references(() => channels.id, { onDelete: 'cascade' }),
  level: text('level'),
  muted: integer('muted').notNull().default(0),
  mutedUntil: integer('muted_until'),
  suppressEveryone: integer('suppress_everyone').notNull().default(0),
  suppressRoles: integer('suppress_roles').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  // One space-wide row and one row per channel, per user. Two partial
  // indexes because a NULL channel_id never collides in a plain unique index.
  spaceRowIdx: uniqueIndex('idx_notification_settings_space_row')
    .on(table.userId, table.spaceId)
    .where(sql`${table.channelId} IS NULL`),
  channelRowIdx: uniqueIndex('idx_notification_settings_channel_row')
    .on(table.userId, table.channelId)
    .where(sql`${table.channelId} IS NOT NULL`),
}));

export const spaceFolders = sqliteTable('space_folders', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name'),
  color: text('color'),
  position: integer('position').default(0),
  createdAt: integer('created_at').notNull(),
});

export const spaceFolderMembers = sqliteTable('space_folder_members', {
  folderId: text('folder_id').notNull().references(() => spaceFolders.id, { onDelete: 'cascade' }),
  spaceId: text('space_id').notNull(),
  position: integer('position').default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.folderId, table.spaceId] }),
}));

export const userSpaceLayout = sqliteTable('user_space_layout', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  layout: text('layout').notNull().default('[]'),
  updatedAt: integer('updated_at').notNull(),
});

export const instanceSettings = sqliteTable('instance_settings', {
  id: integer('id').primaryKey().default(1),
  instanceName: text('instance_name').default('Backspace'),
  workerId: integer('worker_id'),
  maxBitrateKbps: integer('max_bitrate_kbps').notNull().default(20000),
  minBitrateKbps: integer('min_bitrate_kbps').notNull().default(500),
  bitrateStepKbps: integer('bitrate_step_kbps').notNull().default(500),
  allowedResolutions: text('allowed_resolutions').notNull().default('540,720,1080'),
  allowedFramerates: text('allowed_framerates').notNull().default('30,45,60'),
  maxResolution: integer('max_resolution').notNull().default(1080),
  maxFramerate: integer('max_framerate').notNull().default(60),
  registrationOpen: integer('registration_open'),  // null = use env var default, 0/1 = explicit
  spaceCreationOpen: integer('space_creation_open').notNull().default(1),
  gifApiKey: text('gif_api_key'),
  bitrateMatrixOverrides: text('bitrate_matrix_overrides'),
  allowCustomBitrate: integer('allow_custom_bitrate').notNull().default(1),
  maxUploadSizeBytes: integer('max_upload_size_bytes'),
  maxStickerSizeBytes: integer('max_sticker_size_bytes'),
  /** First-boot timestamp (ms); backfilled by ensureDefaults, so non-null after boot. */
  installedAt: integer('installed_at'),
  updatedAt: integer('updated_at').notNull(),
}, table => ({ singleton: check('instance_settings_singleton', sql`${table.id} = 1`) }));

export const bans = sqliteTable('bans', {
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  reason: text('reason'),
  bannedBy: text('banned_by').references(() => users.id),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.spaceId, table.userId] }),
  spaceIdx: index('idx_bans_space_id').on(table.spaceId),
}));

export const joinRequests = sqliteTable('join_requests', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  message: text('message'),
  status: text('status').notNull().default('pending'),
  decidedBy: text('decided_by').references(() => users.id),
  createdAt: integer('created_at').notNull(),
  decidedAt: integer('decided_at'),
}, (table) => ({
  spaceStatusIdx: index('idx_join_requests_space_id_status').on(table.spaceId, table.status),
}));

export const voiceRestrictions = sqliteTable('voice_restrictions', {
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  restrictionType: text('restriction_type').notNull(), // 'mute' | 'deafen'
  moderatorId: text('moderator_id').references(() => users.id),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.spaceId, table.userId, table.restrictionType] }),
  spaceIdx: index('idx_voice_restrictions_space_id').on(table.spaceId),
}));

/**
 * A bot's access tokens: `bsb_<id>.<secret>`, shown once. Only the SHA-256 of
 * the secret is stored, so a copy of the database yields no usable token. A
 * bot holds up to MAX_BOT_TOKENS_PER_BOT, each revocable on its own; the
 * rows go with the bot (cascade on a real delete, explicit on a tombstone).
 */
export const botTokens = sqliteTable('bot_tokens', {
  /** The public half of the token (16 hex chars): the lookup key. */
  id: text('id').primaryKey(),
  botId: text('bot_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  name: text('name'),
  createdAt: integer('created_at').notNull(),
  /** Written at most once a minute per token. */
  lastUsedAt: integer('last_used_at'),
}, (table) => ({
  botIdx: index('idx_bot_tokens_bot_id').on(table.botId),
}));

/**
 * A moderator's mute or deafen of one bot SEAT (a `bot_voice_join` seat in one
 * voice channel). A bot sits in several channels at once, so its restrictions
 * are kept per channel; a person's stay per space in `voice_restrictions`.
 */
export const botSeatRestrictions = sqliteTable('bot_seat_restrictions', {
  channelId: text('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  botId: text('bot_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  restrictionType: text('restriction_type').notNull(), // 'mute' | 'deafen'
  moderatorId: text('moderator_id').references(() => users.id),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.channelId, table.botId, table.restrictionType] }),
  botIdx: index('idx_bot_seat_restrictions_bot_id').on(table.botId),
}));

export const inviteLinks = sqliteTable('invite_links', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  name: text('name').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at').notNull(),
  maxUses: integer('max_uses'),
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: integer('expires_at'),
  revokedAt: integer('revoked_at'),
}, (table) => ({
  createdAtIdx: index('idx_invite_links_created_at').on(table.createdAt),
}));

export const inviteRedemptions = sqliteTable('invite_redemptions', {
  id: text('id').primaryKey(),
  inviteId: text('invite_id').notNull().references(() => inviteLinks.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  registrantUsername: text('registrant_username').notNull(),
  redeemedAt: integer('redeemed_at').notNull(),
}, (table) => ({
  inviteIdx: index('idx_invite_redemptions_invite_id').on(table.inviteId),
  userIdx: index('idx_invite_redemptions_user_id').on(table.userId),
}));

/** Slash commands a bot registers for itself (replace-all through PUT /api/bots/@me/commands). */
export const botCommands = sqliteTable('bot_commands', {
  id: text('id').primaryKey(),
  botId: text('bot_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  /** JSON array of BotCommandOption. */
  options: text('options').notNull().default('[]'),
  updatedAt: integer('updated_at').notNull(),
  /**
   * Permissions a person needs in the invoking channel to see and use the
   * command (canonical decimal mask); null for none. Its subcommands and
   * groups may add their own, in `options`.
   */
  requiredPermissions: text('required_permissions'),
}, (table) => ({
  botNameIdx: uniqueIndex('idx_bot_commands_bot_name').on(table.botId, table.name),
}));

/** One slash-command invocation, kept until it expires so only the invoked bot can answer it. */
export const interactions = sqliteTable('interactions', {
  id: text('id').primaryKey(),
  botId: text('bot_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channelId: text('channel_id'),
  dmChannelId: text('dm_channel_id'),
  command: text('command').notNull(),
  /** JSON object of the validated option values. */
  options: text('options').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  responses: integer('responses').notNull().default(0),
}, (table) => ({
  expiresIdx: index('idx_interactions_expires_at').on(table.expiresAt),
}));

// Assets outlive personal collections so removing a favorite cannot break message history.
export const stickerAssets = sqliteTable('sticker_assets', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
});

export const personalStickers = sqliteTable('personal_stickers', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  stickerId: text('sticker_id').notNull().references(() => stickerAssets.id),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.userId, table.stickerId] }) }));

export const stickerPacks = sqliteTable('sticker_packs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  creatorId: text('creator_id').references(() => users.id, { onDelete: 'set null' }),
  creatorName: text('creator_name'),
  coverAssetId: text('cover_asset_id').references(() => stickerAssets.id, { onDelete: 'set null' }),
  currentVersion: integer('current_version').notNull().default(1),
  status: text('status').notNull().default('draft'),
  reviewNotes: text('review_notes'),
  reviewedBy: text('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: integer('reviewed_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  statusIdx: index('idx_sticker_packs_status').on(table.status),
  creatorIdx: index('idx_sticker_packs_creator').on(table.creatorId),
}));

export const stickerPackVersions = sqliteTable('sticker_pack_versions', {
  id: text('id').primaryKey(),
  packId: text('pack_id').notNull().references(() => stickerPacks.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  coverAssetId: text('cover_asset_id').references(() => stickerAssets.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('draft'),
  reviewNotes: text('review_notes'),
  reviewedBy: text('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: integer('reviewed_at'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  packVersionIdx: uniqueIndex('idx_pack_versions_unique').on(table.packId, table.version),
}));

export const stickerPackItems = sqliteTable('sticker_pack_items', {
  id: text('id').primaryKey(),
  packId: text('pack_id').notNull().references(() => stickerPacks.id, { onDelete: 'cascade' }),
  versionId: text('version_id').notNull().references(() => stickerPackVersions.id, { onDelete: 'cascade' }),
  assetId: text('asset_id').notNull().references(() => stickerAssets.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  packIdx: index('idx_sticker_pack_items_pack').on(table.packId),
  versionIdx: index('idx_sticker_pack_items_version').on(table.versionId),
  assetIdx: index('idx_sticker_pack_items_asset').on(table.assetId),
}));

export const userInstalledPacks = sqliteTable('user_installed_packs', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  packId: text('pack_id').notNull().references(() => stickerPacks.id, { onDelete: 'cascade' }),
  installedAt: integer('installed_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.packId] }),
  userIdx: index('idx_user_installed_packs_user').on(table.userId),
}));

// Game icon assets: content-addressed WebP the desktop client extracted from
// the player's own machine and uploaded so an activity can carry an icon URL
// the uploader's own instance hosts. No third-party CDN is ever contacted.
export const gameIconAssets = sqliteTable('game_icon_assets', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
});

// The per-uploader rows the quota counts; the asset file is shared across
// uploaders when two machines extracted the very same bytes.
export const gameIcons = sqliteTable('game_icons', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  iconId: text('icon_id').notNull().references(() => gameIconAssets.id),
  createdAt: integer('created_at').notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.userId, table.iconId] }) }));
