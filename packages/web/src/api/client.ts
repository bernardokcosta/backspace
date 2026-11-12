import type { ChatCommandsResponse, CreateInteractionRequest, CreateInteractionResponse } from '@veyvox/shared';
import type { PersonalSticker, StickerPackSummary, StickerPackDetail, StickerPackItem } from '@veyvox/shared/src/stickers';
import type { SoundboardDocument, SoundboardSettings, SoundboardSound } from '@veyvox/shared/src/soundboard';
import type { GameIconUpload } from '@veyvox/shared/src/gameIcons';
import type { JunoCommand, JunoSnapshot, JunoRankingPage } from '@veyvox/shared/src/juno';
import { isErrorCode, type ErrorCode, type ErrorDetails } from '@veyvox/shared/src/errors';
import i18n from '../i18n';
import { isRateLimitScope, parseRetryAfterSeconds, type RateLimitScope } from '@veyvox/shared/src/retryAfter';
import { createReadRecovery } from './readRecovery';
import type {
  NotificationSetting,
  NotificationSettingsResponse,
  UpdateNotificationSettingRequest,
  AuthResponse,
  RegisterRequest,
  LoginRequest,
  User,
  Space,
  SpaceWithChannelsAndMembers,
  Channel,
  ChannelCategory,
  MessageWithUser,
  PinnedMessage,
  PinWithMessage,
  MemberWithUser,
  DmChannel,
  DmMessageWithUser,
  CreateSpaceRequest,
  UpdateSpaceRequest,
  CreateChannelRequest,
  UpdateChannelRequest,
  CreateMessageRequest,
  UpdateMessageRequest,
  UpdateUserRequest,
  JoinSpaceRequest,
  UpdateMemberRequest,
  LiveKitTokenResponse,
  CreateDmRequest,
  AddDmMemberRequest,
  CreateGroupDmRequest,
  TransferOwnershipRequest,
  CreateDmMessageRequest,
  Friend,
  FriendRequest,
  SendFriendRequest,
  DiscoverUser,
  InstanceStreamingLimits,
  InstanceAdminSettings,
  InstanceInfoResponse,
  VerifyPasswordResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
  DeleteAccountRequest,
  StorageStats,
  OrphanedFile,
  CleanupResult,
  AdminUserListResponse,
  AdminUser,
  AdminResetPasswordResponse,
  InstanceUpdateStatus,
  JoinRequest,
  Role,
  SpaceLayoutItem,
  SpaceFolder,
  InvitePreview,
  GifResult,
  InviteLinkSummary,
  InviteRedemption,
  CreateInviteRequest,
  UpdateInviteRequest,
  ReinstateInviteRequest,
  ReinstateInviteResponse,
  CheckInviteResponse,
  SpaceInviteRequest,
  SpaceInviteResponse,
  BotSearchResult,
  BotSummary,
  CreateBotRequest,
  UpdateBotRequest,
  UpdateBotResponse,
  CreateBotResponse,
  RegenerateBotTokenResponse,
  BotTokensResponse,
  CreateBotTokenRequest,
  CreateBotTokenResponse,
  BotSpacesResponse,
} from '@veyvox/shared';
import { MESSAGE_PAGING_AFTER, MESSAGE_PAGING_HEADER } from '@veyvox/shared';
import { recordDiagnostic } from '../utils/diagnostics';
import { diagnosticError } from '@veyvox/shared/src/diagnostics';

/**
 * Reply of the username availability check. `reason` is the server's
 * English text; `code` and `details` let the client say it in the user's
 * language.
 */
export interface CheckUsernameResponse {
  available: boolean;
  reason?: string;
  code?: ErrorCode;
  details?: ErrorDetails;
}

/**
 * A history request with an `after` cursor. `forward` is false when the
 * server ignored the cursor (it predates forward paging): `messages` is then
 * the newest page, not the page after the cursor.
 */
export interface HistoryPageAfter<T> {
  messages: T[];
  forward: boolean;
}

/**
 * A channel or category override write. `version` is the version of the row
 * the edit started from (`overrideVersion`, permissions.md "Concurrent
 * edits"); the server answers 409 `overrides_conflict` when the row has
 * changed since. A server from before the check ignores it.
 */
export interface OverrideWriteBody {
  targetType: string;
  targetId: string;
  allow: string;
  deny: string;
  version?: string;
}

/**
 * A role update. `permissionsVersion` is the version of the permissions the
 * edit started from (`rolePermissionsVersion`); with `permissions`, the server
 * answers 409 `role_permissions_conflict` when the role's permissions have
 * changed since.
 */
export interface RoleUpdateBody {
  name?: string;
  color?: string;
  position?: number;
  above?: string;
  below?: string;
  permissions?: string;
  permissionsVersion?: string;
}

/** The `?version=` of an override delete, or nothing when there is no version to send. */
function versionQuery(version: string | undefined): string {
  return version === undefined ? '' : `?${new URLSearchParams({ version }).toString()}`;
}

/** The parts of an error body the client reads; see HttpError.fromBody for the vintages. */
function readErrorBody(body: unknown): { errorText?: string; code?: ErrorCode; details?: ErrorDetails } {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const errorText = typeof record.error === 'string' && record.error.length > 0 ? record.error : undefined;
  const code = isErrorCode(record.code) ? record.code : isErrorCode(record.error) ? record.error : undefined;
  const details = typeof record.details === 'object' && record.details !== null
    ? (record.details as ErrorDetails)
    : undefined;
  return { errorText, code, details };
}

export class HttpError extends Error {
  readonly status: number;
  readonly body?: unknown;
  /** Stable server error code, when the route sends one; see packages/shared/src/errors.ts. */
  readonly code?: ErrorCode;
  /** Interpolation values for the localized message, e.g. `{ max: 32 }`. */
  readonly details?: ErrorDetails;

  constructor(status: number, message: string, body?: unknown, code?: ErrorCode, details?: ErrorDetails) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.code = code;
    this.details = details;
  }

  /**
   * Build from a failed response body of any vintage.
   *
   * Current routes send `{ error, code, statusCode, details? }`. Routes not
     * yet converted on older servers send `{ error }` alone, and
   * some of those put the code in `error` itself. Only codes the shared list
     * knows are accepted, so a response cannot inject arbitrary catalog keys.
   */
  static fromBody(status: number, body: unknown): HttpError {
    const { errorText, code, details } = readErrorBody(body);
    return new HttpError(status, errorText ?? `HTTP ${status}`, body, code, details);
  }
}

/**
 * A 429 from any route. An HttpError with the body's own code when the
 * route sends one (`lookup_rate_limited`, say) and `rate_limited` otherwise,
 * so `describeError` says it in the user's language, plus the seconds to
 * wait for the surfaces that count down (the auth pages).
 */
export class RateLimitError extends HttpError {
  /** Seconds until the limiter admits the next request: the body's `retryAfter`, the Retry-After header, or 60. */
  readonly retryAfter: number;
  readonly scope?: RateLimitScope;

  constructor(retryAfter: number, body?: unknown) {
    const { errorText, code, details } = readErrorBody(body);
    super(429, errorText ?? 'Rate limit exceeded', body, code ?? 'rate_limited', details);
    this.name = 'RateLimitError';
    this.retryAfter = parseRetryAfterSeconds({ retryAfter }, null);
    const scope = typeof body === 'object' && body !== null
      ? (body as { rateLimitScope?: unknown }).rateLimitScope : undefined;
    this.scope = isRateLimitScope(scope) ? scope : undefined;
  }
}

export class VeyvoxApiClient {
  /** Cancel this client's reads/recovery, never a handed-off mutation. */
  readonly cancelPendingReads: () => void;
  readonly auth: {
    register: (data: RegisterRequest) => Promise<AuthResponse>;
    login: (data: LoginRequest) => Promise<AuthResponse>;
    checkUsername: (username: string) => Promise<CheckUsernameResponse>;
    checkInvite: (token: string) => Promise<CheckInviteResponse>;
  };

  readonly users: {
    me: () => Promise<User>;
    update: (data: UpdateUserRequest) => Promise<User>;
    get: (id: string) => Promise<User>;
    verifyPassword: (password: string) => Promise<VerifyPasswordResponse>;
    changePassword: (data: ChangePasswordRequest) => Promise<ChangePasswordResponse>;
    deleteAccount: (data: DeleteAccountRequest) => Promise<{ success: boolean }>;
    getMutuals: (id: string) => Promise<{ mutualFriends: User[]; mutualSpaces: { id: string; name: string; icon: string | null; avatarColor: string | null }[] }>;
  };

  readonly spaceLayout: {
    update: (data: { items: SpaceLayoutItem[]; folders: Record<string, { name: string | null; color: string | null; spaceIds: string[] }>; updatedAt?: number }) => Promise<{ items: SpaceLayoutItem[]; folders: SpaceFolder[]; updatedAt?: number }>;
  };

  /**
   * The signed-in user's notification settings on this instance. Called on
   * the client of the instance that hosts the space (origin routing).
   */
  readonly notificationSettings: {
    list: () => Promise<NotificationSettingsResponse>;
    updateSpace: (spaceId: string, data: UpdateNotificationSettingRequest) => Promise<NotificationSetting>;
    updateChannel: (channelId: string, data: UpdateNotificationSettingRequest) => Promise<NotificationSetting>;
  };

  readonly spaces: {
    list: () => Promise<Space[]>;
    get: (id: string) => Promise<SpaceWithChannelsAndMembers>;
    create: (data: CreateSpaceRequest) => Promise<Space>;
    update: (id: string, data: UpdateSpaceRequest) => Promise<Space>;
    delete: (id: string) => Promise<{ success: boolean }>;
    invite: (id: string) => Promise<{ inviteCode: string }>;
    join: (id: string, data: JoinSpaceRequest) => Promise<Space>;
    joinByCode: (inviteCode: string) => Promise<Space>;
    members: (id: string) => Promise<MemberWithUser[]>;
    updateMember: (spaceId: string, userId: string, data: UpdateMemberRequest) => Promise<MemberWithUser>;
    removeMember: (spaceId: string, userId: string) => Promise<{ success: boolean }>;
    getBans: (spaceId: string) => Promise<{ spaceId: string; userId: string; reason: string | null; bannedBy: string; createdAt: number; user: any; moderator: any }[]>;
    ban: (spaceId: string, userId: string, reason?: string) => Promise<{ success: boolean }>;
    unban: (spaceId: string, userId: string) => Promise<{ success: boolean }>;
    transferOwnership: (spaceId: string, newOwnerId: string) => Promise<Space>;
    invitePreview: (code: string) => Promise<InvitePreview>;
  };

  readonly channels: {
    list: (spaceId: string) => Promise<Channel[]>;
    create: (spaceId: string, data: CreateChannelRequest) => Promise<Channel>;
    update: (id: string, data: UpdateChannelRequest) => Promise<Channel>;
    delete: (id: string) => Promise<{ success: boolean }>;
    messages: (id: string, before?: string, limit?: number) => Promise<MessageWithUser[]>;
    messagesAround: (id: string, messageId: string, limit?: number) => Promise<MessageWithUser[]>;
    messagesAfter: (id: string, after: string, limit?: number) => Promise<HistoryPageAfter<MessageWithUser>>;
    sendMessage: (channelId: string, data: CreateMessageRequest) => Promise<MessageWithUser>;
    /** Delivery acknowledgment only; never applies stale response data to UI. */
    sendMessageReceipt: (channelId: string, data: CreateMessageRequest) => Promise<void>;
    pins: (id: string) => Promise<{ pins: PinWithMessage[] }>;
    pinMessage: (id: string, messageId: string) => Promise<{ pin: PinnedMessage }>;
    unpinMessage: (id: string, messageId: string) => Promise<{ success: boolean }>;
    getOverrides: (channelId: string) => Promise<{ channelId: string; targetType: string; targetId: string; allow: string; deny: string; version?: string }[]>;
    putOverride: (channelId: string, data: OverrideWriteBody) => Promise<{ success: boolean; version?: string }>;
    deleteOverride: (channelId: string, targetType: string, targetId: string, version?: string) => Promise<{ success: boolean }>;
    updateLayout: (spaceId: string, data: { channels: Array<{ id: string; position: number; categoryId: string | null }>; categories: Array<{ id: string; position: number }> }) => Promise<{ success: boolean }>;
  };

  readonly categories: {
    create: (spaceId: string, name: string) => Promise<ChannelCategory>;
    update: (id: string, data: { name?: string; position?: number }) => Promise<ChannelCategory>;
    delete: (id: string) => Promise<{ success: boolean }>;
    getOverrides: (categoryId: string) => Promise<{ categoryId: string; targetType: string; targetId: string; allow: string; deny: string; version?: string }[]>;
    putOverride: (categoryId: string, data: OverrideWriteBody) => Promise<{ success: boolean; version?: string }>;
    deleteOverride: (categoryId: string, targetType: string, targetId: string, version?: string) => Promise<{ success: boolean }>;
  };

  readonly messages: {
    update: (id: string, data: UpdateMessageRequest) => Promise<MessageWithUser>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  readonly uploads: {
    url: (filename: string) => string;
  };

  readonly dm: {
    list: () => Promise<DmChannel[]>;
    create: (data: CreateDmRequest) => Promise<DmChannel>;
    createGroup: (data: CreateGroupDmRequest) => Promise<DmChannel>;
    close: (id: string) => Promise<{ success: boolean }>;
    messages: (id: string, before?: string, limit?: number) => Promise<DmMessageWithUser[]>;
    messagesAround: (id: string, messageId: string, limit?: number) => Promise<DmMessageWithUser[]>;
    messagesAfter: (id: string, after: string, limit?: number) => Promise<HistoryPageAfter<DmMessageWithUser>>;
    sendMessage: (id: string, data: CreateDmMessageRequest) => Promise<DmMessageWithUser>;
    sendMessageReceipt: (id: string, data: CreateDmMessageRequest) => Promise<void>;
    updateMessage: (id: string, data: UpdateMessageRequest) => Promise<DmMessageWithUser>;
    deleteMessage: (id: string) => Promise<{ success: boolean }>;
    addMember: (dmChannelId: string, data: AddDmMemberRequest) => Promise<DmChannel>;
    leave: (dmChannelId: string) => Promise<{ success: boolean }>;
    /**
     * Owner-only: rename a local group DM and/or update its icon.
     */
    updateMetadata: (channelId: string, body: { name?: string | null; icon?: string | null }) => Promise<DmChannel>;
    /** Owner-only: remove an existing local member. */
    kickMember: (channelId: string, userId: string) => Promise<{ success: boolean }>;
    transferOwnership: (channelId: string, body: TransferOwnershipRequest) => Promise<DmChannel>;
    spaceInvite: (body: SpaceInviteRequest) => Promise<SpaceInviteResponse>;
  };

  readonly social: {
    friends: () => Promise<Friend[]>;
    requests: () => Promise<FriendRequest[]>;
    sendRequest: (body: SendFriendRequest) => Promise<{ success: boolean; requestId?: string }>;
    updateRequest: (id: string, status: 'accepted' | 'declined') => Promise<{ success: boolean }>;
    removeFriend: (id: string) => Promise<{ success: boolean }>;
    cancelRequest: (id: string) => Promise<{ success: boolean }>;
    search: (q: string) => Promise<User[]>;
    discover: (q?: string, limit?: number, offset?: number) => Promise<{ users: DiscoverUser[]; total: number }>;
  };

  readonly livekit: {
    token: (channelId: string) => Promise<LiveKitTokenResponse>;
    dmToken: (dmChannelId: string) => Promise<LiveKitTokenResponse>;
  };

  readonly settings: {
    getStreaming: () => Promise<InstanceStreamingLimits>;
    updateStreaming: (data: Partial<InstanceStreamingLimits>) => Promise<InstanceStreamingLimits>;
    getInstance: () => Promise<InstanceAdminSettings>;
    updateInstance: (data: Partial<InstanceAdminSettings>) => Promise<InstanceAdminSettings>;
  };

  readonly instance: {
    info: () => Promise<InstanceInfoResponse>;
  };

  readonly roles: {
    create: (spaceId: string, data: { name: string; color?: string; permissions?: string }) => Promise<Role>;
    update: (spaceId: string, roleId: string, data: RoleUpdateBody) => Promise<Role>;
    delete: (spaceId: string, roleId: string) => Promise<{ success: boolean }>;
  };

  readonly search: {
    channel: (channelId: string, params: { q?: string; from?: string; has?: string; before?: string; after?: string; offset?: number; limit?: number }) => Promise<{ results: MessageWithUser[]; totalCount: number }>;
    dm: (dmChannelId: string, params: { q?: string; from?: string; has?: string; before?: string; after?: string; offset?: number; limit?: number }) => Promise<{ results: DmMessageWithUser[]; totalCount: number }>;
  };

  readonly joinRequests: {
    request: (spaceId: string, message?: string) => Promise<JoinRequest>;
    list: (spaceId: string, status?: string) => Promise<{ requests: JoinRequest[] }>;
    decide: (spaceId: string, requestId: string, action: 'accept' | 'decline') => Promise<JoinRequest>;
    mine: (status?: string) => Promise<{ requests: JoinRequest[] }>;
  };

  readonly gif: {
    trending: (limit?: number, pos?: string) => Promise<{ results: GifResult[]; next: string }>;
    search: (q: string, limit?: number, pos?: string) => Promise<{ results: GifResult[]; next: string }>;
    enabled: () => Promise<{ enabled: boolean }>;
  };

  readonly commands: {
    forChat: (target: { channelId?: string; dmChannelId?: string }) => Promise<ChatCommandsResponse>;
    invoke: (body: CreateInteractionRequest) => Promise<CreateInteractionResponse>;
  };

  readonly bots: {
    list: () => Promise<{ bots: BotSummary[] }>;
    search: (q: string) => Promise<{ bots: BotSearchResult[] }>;
    create: (data: CreateBotRequest) => Promise<CreateBotResponse>;
    regenerateToken: (id: string) => Promise<RegenerateBotTokenResponse>;
    listTokens: (id: string) => Promise<BotTokensResponse>;
    createToken: (id: string, data: CreateBotTokenRequest) => Promise<CreateBotTokenResponse>;
    revokeToken: (id: string, tokenId: string) => Promise<{ success: boolean }>;
    update: (id: string, data: UpdateBotRequest) => Promise<UpdateBotResponse>;
    spaces: (id: string) => Promise<BotSpacesResponse>;
    /** `permissions`: the grant out of the bot's requested permissions; omitted, the server grants every requested bit the caller holds. */
    addToSpace: (id: string, spaceId: string, permissions?: string) => Promise<{ success: boolean }>;
    removeFromSpace: (id: string, spaceId: string) => Promise<{ success: boolean }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };

  readonly invites: {
    list: (status?: 'active' | 'archived') => Promise<{ invites: InviteLinkSummary[] }>;
    create: (body: CreateInviteRequest) => Promise<InviteLinkSummary>;
    update: (id: string, body: UpdateInviteRequest) => Promise<InviteLinkSummary>;
    revoke: (id: string) => Promise<{ invite: InviteLinkSummary }>;
    reinstate: (id: string, body: ReinstateInviteRequest) => Promise<ReinstateInviteResponse>;
    delete: (id: string) => Promise<{ success: boolean }>;
    redemptions: (id: string) => Promise<{ redemptions: InviteRedemption[] }>;
  };

  readonly admin: {
    storageStats: () => Promise<StorageStats>;
    storageOrphans: () => Promise<{ orphans: OrphanedFile[] }>;
    storageCleanup: (dryRun?: boolean) => Promise<CleanupResult>;
    cleanupOldMedia: (maxAgeDays: number, dryRun?: boolean) => Promise<CleanupResult>;
    cleanupTusSessions: (maxAgeHours: number, dryRun?: boolean) => Promise<CleanupResult>;
    listUsers: (params?: { q?: string; page?: number; pageSize?: number; showDeleted?: boolean; role?: string; joinedAfter?: string; joinedBefore?: string; sort?: string }) => Promise<AdminUserListResponse>;
    setUserRole: (userId: string, isAdmin: boolean) => Promise<AdminUser>;
    resetUserPassword: (userId: string) => Promise<AdminResetPasswordResponse>;
    deleteUser: (userId: string) => Promise<{ success: boolean }>;
    updateStatus: (refresh?: boolean) => Promise<InstanceUpdateStatus>;
    stickerPacks: {
      listReviews: () => Promise<StickerPackSummary[]>;
      approve: (id: string) => Promise<{ success: boolean; status: string }>;
      reject: (id: string, reviewNotes?: string) => Promise<{ success: boolean; status: string }>;
      listAll: (params?: { status?: string; q?: string }) => Promise<StickerPackSummary[]>;
      setStatus: (id: string, status: string) => Promise<{ success: boolean; status: string }>;
    };
  };

  stickers: {
    list: () => Promise<PersonalSticker[]>;
    upload: (data: { name: string; image: string }) => Promise<PersonalSticker>;
    collect: (data: { id: string; token: string; name: string }) => Promise<PersonalSticker>;
    rename: (id: string, name: string) => Promise<PersonalSticker>;
    remove: (id: string) => Promise<{ success: boolean }>;
  };

  juno: {
    get: (channelId: string, supportsIntoxicated?: boolean) => Promise<JunoSnapshot>;
    command: (channelId: string, command: JunoCommand, supportsIntoxicated?: boolean) => Promise<JunoSnapshot>;
    ranking: (spaceId: string, query?: { limit?: number; offset?: number }) => Promise<JunoRankingPage>;
  };
  soundboard: {
    list: (spaceId: string) => Promise<SoundboardDocument>;
    settings: (spaceId: string, data: SoundboardSettings) => Promise<SoundboardSettings>;
    upload: (spaceId: string, data: { name: string; emoji: string; audio: string }) => Promise<SoundboardSound>;
    remove: (spaceId: string, soundId: string) => Promise<{ success: boolean }>;
    play: (spaceId: string, soundId: string, channelId: string) => Promise<{ success: boolean }>;
  };
  stickerStore: {
    listPacks: (params?: { q?: string }) => Promise<StickerPackSummary[]>;
    getPack: (id: string) => Promise<StickerPackDetail>;
    install: (id: string) => Promise<{ success: boolean }>;
    uninstall: (id: string) => Promise<{ success: boolean }>;
    myPacks: () => Promise<StickerPackDetail[]>;
    createPack: (data: { name: string; description?: string; coverAssetId?: string }) => Promise<StickerPackSummary>;
    listCreated: () => Promise<StickerPackSummary[]>;
    getCreated: (id: string) => Promise<StickerPackDetail>;
    updatePack: (id: string, data: { name: string; description: string }) => Promise<{ success: boolean }>;
    addItem: (packId: string, data: { name: string; image: string }) => Promise<StickerPackItem>;
    removeItem: (packId: string, itemId: string) => Promise<{ success: boolean }>;
    reorderItems: (packId: string, itemIds: string[]) => Promise<{ success: boolean }>;
    submitReview: (packId: string) => Promise<{ success: boolean; status: string }>;
    newVersion: (packId: string) => Promise<{ id: string; newVersion: number; versionId: string; status: string }>;
    deletePack: (id: string) => Promise<{ success: boolean }>;
  };
  gameIcons: {
    upload: (data: { image: string }) => Promise<GameIconUpload>;
  };

  constructor(baseUrl: string, getToken: () => string | null, onUnauthorized?: () => void) {
    let sessionGeneration = 0;
    const recovery = createReadRecovery(getToken, error =>
      error instanceof RateLimitError && error.scope ? error.retryAfter : null);
    this.cancelPendingReads = () => { sessionGeneration++; recovery.cancel(); };
    const unauthorizedReads = new WeakSet<HttpError>();

    function safeRead<T>(key: string, read: (signal: AbortSignal) => Promise<T>, requireAuth = true): Promise<T> {
      const session = getToken();
      const generation = sessionGeneration;
      return recovery.run(key, read).then(value => structuredClone(value)).catch((error: unknown) => {
        // Notify only after recovery has settled the authoritative refusal.
        // The callback may itself clear the token/cancel other pending reads.
        if (error instanceof HttpError && error.status === 401 && requireAuth
            && generation === sessionGeneration && getToken() === session && !unauthorizedReads.has(error)) {
          unauthorizedReads.add(error); onUnauthorized?.();
        }
        throw error;
      });
    }

    /** Keep cancellation/timeout ownership through body consumption, not just headers. */
    async function send<T>(
      method: string,
      path: string,
      body: unknown,
      requireAuth: boolean,
      consume: (response: Response) => Promise<T>,
      signal?: AbortSignal,
    ): Promise<T> {
      const headers: Record<string, string> = {};

      if (body) {
        headers['Content-Type'] = 'application/json';
      }

      const token = getToken();
      const generation = sessionGeneration;
      if (requireAuth && token) headers['Authorization'] = `Bearer ${token}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) controller.abort();

      try {
        let response: Response;
        try {
          response = await fetch(`${baseUrl}${path}`, {
            method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal,
          });
        } catch (error) {
          if (!signal?.aborted) recordDiagnostic({ event: 'api-failed', subsystem: 'api', level: 'error', method, route: path, ...diagnosticError(error) });
          throw error;
        }
        const current = () => generation === sessionGeneration && !signal?.aborted && (!requireAuth || getToken() === token);
        if (method === 'GET' && !current()) { void response.body?.cancel().catch(() => {}); throw new DOMException('', 'AbortError'); }
        if (!response.ok) {
          const errorBody: unknown = await response.json().catch(() => null);
          const error = HttpError.fromBody(response.status, errorBody);
          if (method === 'GET' && !current()) throw new DOMException('', 'AbortError');
          recordDiagnostic({ event: 'api-failed', subsystem: 'api', level: response.status >= 500 ? 'error' : 'warning',
            method, route: path, status: response.status, ...(error.code ? { errorCode: error.code } : {}) });
          if (method !== 'GET' && response.status === 401 && requireAuth && current()) onUnauthorized?.();
          if (response.status === 429) throw new RateLimitError(parseRetryAfterSeconds(errorBody, response.headers.get('retry-after')), errorBody);
          throw error;
        }
        const value = await consume(response);
        if (method === 'GET' && !current()) throw new DOMException('', 'AbortError');
        return value;
      } catch (err) {
        if (!signal?.aborted && err instanceof DOMException && err.name === 'AbortError'
            && (!requireAuth || getToken() === token)) {
          throw new Error(i18n.t('errors:clientRequestTimeout'));
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', abort);
      }
    }

    async function request<T>(
      method: string,
      path: string,
      body?: unknown,
      requireAuth = true,
    ): Promise<T> {
      const read = (signal?: AbortSignal) => send(method, path, body, requireAuth, response => response.json() as Promise<T>, signal);
      return method === 'GET' ? safeRead(`json:${requireAuth}:${path}`, read, requireAuth) : read();
    }

    async function messageReceipt(path: string, data: CreateMessageRequest | CreateDmMessageRequest): Promise<void> {
      await send('POST', path, data, true, async response => {
        // Acknowledged mutations settle even if a read lifecycle was cancelled.
        void response.body?.cancel().catch(() => {});
      });
    }

    /**
     * The page after `after` in a channel's or DM's history. `forward` says
     * whether the server honoured the cursor; a server that predates forward
     * paging answers with the newest page instead (docs/systems/api.md,
     * "Message history paging").
     */
    async function historyAfter<T>(path: string, after: string, limit: number): Promise<HistoryPageAfter<T>> {
      const params = new URLSearchParams();
      params.set('after', after);
      params.set('limit', String(limit));
      const target = `${path}?${params}`;
      return safeRead(`history:${target}`, signal => send('GET', target, undefined, true, async response => ({
        messages: await response.json() as T[],
        forward: response.headers.get(MESSAGE_PAGING_HEADER) === MESSAGE_PAGING_AFTER,
      }), signal));
    }
    this.juno = {
      get: async (channelId, supportsIntoxicated = true) => {
        const route = `/channels/${encodeURIComponent(channelId)}/juno?memory=1`;
        const generation = sessionGeneration, token = getToken();
        try { return await request<JunoSnapshot>('GET', route + (supportsIntoxicated ? '&intoxicated=1' : '')); }
        catch (error) {
          // Old hosts reject unknown query keys before reading the table. Only
          // this read-only protocol probe may fall back, in the same session.
          if (!supportsIntoxicated || !(error instanceof HttpError) || error.status !== 400 || error.code !== 'invalid_body'
            || generation !== sessionGeneration || getToken() !== token) throw error;
          return request<JunoSnapshot>('GET', route);
        }
      },
      command: (channelId, command, supportsIntoxicated = false) => request<JunoSnapshot>('POST',
        `/channels/${encodeURIComponent(channelId)}/juno?memory=1${supportsIntoxicated ? '&intoxicated=1' : ''}`, command),
      ranking: (spaceId, query = {}) => {
        const params = new URLSearchParams();
        if (query.limit !== undefined) params.set('limit', String(query.limit));
        if (query.offset !== undefined) params.set('offset', String(query.offset));
        return request<JunoRankingPage>('GET', `/spaces/${encodeURIComponent(spaceId)}/juno/ranking${params.size ? `?${params}` : ''}`);
      },
    };
    this.soundboard = {
      list: (spaceId) => request<SoundboardDocument>('GET', `/spaces/${encodeURIComponent(spaceId)}/soundboard`),
      settings: (spaceId, data) => request<SoundboardSettings>('PATCH', `/spaces/${encodeURIComponent(spaceId)}/soundboard/settings`, data),
      upload: (spaceId, data) => request<SoundboardSound>('POST', `/spaces/${encodeURIComponent(spaceId)}/soundboard`, data),
      remove: (spaceId, soundId) => request<{ success: boolean }>('DELETE', `/spaces/${encodeURIComponent(spaceId)}/soundboard/${encodeURIComponent(soundId)}`),
      play: (spaceId, soundId, channelId) => request<{ success: boolean }>('POST', `/spaces/${encodeURIComponent(spaceId)}/soundboard/${encodeURIComponent(soundId)}/play`, { channelId }),
    };

    this.stickers = {
      list: () => request('GET', '/stickers'),
      upload: (data) => request('POST', '/stickers', data),
      collect: ({ id, token, name }) => request('POST', `/stickers/${encodeURIComponent(id)}/collect`, { token, name }),
      rename: (id, name) => request('PATCH', `/stickers/${encodeURIComponent(id)}`, { name }),
      remove: (id) => request('DELETE', `/stickers/${encodeURIComponent(id)}`),
    };

    this.stickerStore = {
      listPacks: (params) => {
        const qs = new URLSearchParams();
        if (params?.q) qs.set('q', params.q);
        return request<StickerPackSummary[]>('GET', `/sticker-store/packs${qs.toString() ? `?${qs}` : ''}`);
      },
      getPack: (id) => request<StickerPackDetail>('GET', `/sticker-store/packs/${encodeURIComponent(id)}`),
      install: (id) => request<{ success: boolean }>('POST', `/sticker-store/packs/${encodeURIComponent(id)}/install`),
      uninstall: (id) => request<{ success: boolean }>('DELETE', `/sticker-store/packs/${encodeURIComponent(id)}/install`),
      myPacks: () => request<StickerPackDetail[]>('GET', '/sticker-store/my-packs'),
      createPack: (data) => request<StickerPackSummary>('POST', '/sticker-packs', data),
      listCreated: () => request<StickerPackSummary[]>('GET', '/sticker-packs/created'),
      getCreated: (id) => request<StickerPackDetail>('GET', `/sticker-packs/${encodeURIComponent(id)}`),
      updatePack: (id, data) => request<{ success: boolean }>('PATCH', `/sticker-packs/${encodeURIComponent(id)}`, data),
      addItem: (packId, data) => request<StickerPackItem>('POST', `/sticker-packs/${encodeURIComponent(packId)}/items`, data),
      removeItem: (packId, itemId) => request<{ success: boolean }>('DELETE', `/sticker-packs/${encodeURIComponent(packId)}/items/${encodeURIComponent(itemId)}`),
      reorderItems: (packId, itemIds) => request<{ success: boolean }>('PUT', `/sticker-packs/${encodeURIComponent(packId)}/items/order`, { itemIds }),
      submitReview: (packId) => request<{ success: boolean; status: string }>('POST', `/sticker-packs/${encodeURIComponent(packId)}/submit`),
      newVersion: (packId) => request<{ id: string; newVersion: number; versionId: string; status: string }>('POST', `/sticker-packs/${encodeURIComponent(packId)}/new-version`),
      deletePack: (id) => request<{ success: boolean }>('DELETE', `/sticker-packs/${encodeURIComponent(id)}`),
    };


    this.gameIcons = {
      upload: (data) => request('POST', '/game-icons', data),
    };

    this.auth = {
      register: (data: RegisterRequest) =>
        request<AuthResponse>('POST', '/auth/register', data, false),
      login: (data: LoginRequest) =>
        request<AuthResponse>('POST', '/auth/login', data, false),
      checkUsername: (username: string) =>
        request<CheckUsernameResponse>('GET', `/auth/check-username?username=${encodeURIComponent(username)}`, undefined, false),
      checkInvite: (token: string) =>
        request<CheckInviteResponse>('GET', `/auth/check-invite?token=${encodeURIComponent(token)}`, undefined, false),
    };

    this.users = {
      me: () => request<User>('GET', '/users/@me'),
      update: (data: UpdateUserRequest) => request<User>('PATCH', '/users/@me', data),
      get: (id: string) => request<User>('GET', `/users/${id}`),
      verifyPassword: (password: string) =>
        request<VerifyPasswordResponse>('POST', '/users/@me/verify-password', { password }),
      changePassword: (data: ChangePasswordRequest) =>
        request<ChangePasswordResponse>('POST', '/users/@me/change-password', data),
      deleteAccount: (data: DeleteAccountRequest) =>
        request<{ success: boolean }>('DELETE', '/users/@me', data),
      getMutuals: (id: string) => {
        return request<{ mutualFriends: User[]; mutualSpaces: { id: string; name: string; icon: string | null; avatarColor: string | null }[] }>(
          'GET', `/users/${encodeURIComponent(id)}/mutuals`
        );
      },
    };

    this.spaceLayout = {
      update: (data) =>
        request<{ items: SpaceLayoutItem[]; folders: SpaceFolder[]; updatedAt?: number }>('PUT', '/users/@me/space-layout', data),
    };

    this.notificationSettings = {
      list: () => request<NotificationSettingsResponse>('GET', '/users/@me/notification-settings'),
      updateSpace: (spaceId, data) =>
        request<NotificationSetting>('PATCH', `/spaces/${encodeURIComponent(spaceId)}/notification-settings`, data),
      updateChannel: (channelId, data) =>
        request<NotificationSetting>('PATCH', `/channels/${encodeURIComponent(channelId)}/notification-settings`, data),
    };

    this.spaces = {
      list: () => request<Space[]>('GET', '/spaces'),
      get: (id: string) => request<SpaceWithChannelsAndMembers>('GET', `/spaces/${id}`),
      create: (data: CreateSpaceRequest) => request<Space>('POST', '/spaces', data),
      update: (id: string, data: UpdateSpaceRequest) => request<Space>('PATCH', `/spaces/${id}`, data),
      delete: (id: string) => request<{ success: boolean }>('DELETE', `/spaces/${id}`),
      invite: (id: string) => request<{ inviteCode: string }>('POST', `/spaces/${id}/invite`),
      join: (id: string, data: JoinSpaceRequest) => request<Space>('POST', `/spaces/${id}/join`, data),
      joinByCode: (inviteCode: string) => request<Space>('POST', '/spaces/join', { inviteCode }),
      members: (id: string) => request<MemberWithUser[]>('GET', `/spaces/${id}/members`),
      updateMember: (spaceId: string, userId: string, data: UpdateMemberRequest) =>
        request<MemberWithUser>('PATCH', `/spaces/${spaceId}/members/${userId}`, data),
      removeMember: (spaceId: string, userId: string) =>
        request<{ success: boolean }>('DELETE', `/spaces/${spaceId}/members/${userId}`),
      getBans: (spaceId: string) =>
        request<any[]>('GET', `/spaces/${spaceId}/bans`),
      ban: (spaceId: string, userId: string, reason?: string) =>
        request<{ success: boolean }>('POST', `/spaces/${spaceId}/bans`, { userId, reason }),
      unban: (spaceId: string, userId: string) =>
        request<{ success: boolean }>('DELETE', `/spaces/${spaceId}/bans/${userId}`),
      transferOwnership: (spaceId: string, newOwnerId: string) =>
        request<Space>('PATCH', `/spaces/${spaceId}/transfer-ownership`, { newOwnerId }),
      invitePreview: (code: string) =>
        request<InvitePreview>('GET', `/spaces/invite/${encodeURIComponent(code)}/preview`, undefined, false),
    };

    this.channels = {
      list: (spaceId: string) => request<Channel[]>('GET', `/spaces/${spaceId}/channels`),
      create: (spaceId: string, data: CreateChannelRequest) =>
        request<Channel>('POST', `/spaces/${spaceId}/channels`, data),
      update: (id: string, data: UpdateChannelRequest) => request<Channel>('PATCH', `/channels/${id}`, data),
      delete: (id: string) => request<{ success: boolean }>('DELETE', `/channels/${id}`),
      messages: (id: string, before?: string, limit = 50) => {
        const params = new URLSearchParams();
        if (before) params.set('before', before);
        params.set('limit', String(limit));
        return request<MessageWithUser[]>('GET', `/channels/${id}/messages?${params}`);
      },
      messagesAfter: (id: string, after: string, limit = 50) =>
        historyAfter<MessageWithUser>(`/channels/${id}/messages`, after, limit),
      messagesAround: (id: string, messageId: string, limit = 50) => {
        const params = new URLSearchParams();
        params.set('messageId', messageId);
        params.set('limit', String(limit));
        return request<MessageWithUser[]>('GET', `/channels/${id}/messages/around?${params}`);
      },
      sendMessage: (channelId: string, data: CreateMessageRequest) =>
        request<MessageWithUser>('POST', `/channels/${channelId}/messages`, data),
      sendMessageReceipt: (channelId: string, data: CreateMessageRequest) =>
        messageReceipt(`/channels/${channelId}/messages`, data),
      pins: (id: string) => request<{ pins: PinWithMessage[] }>('GET', `/channels/${id}/pins`),
      pinMessage: (id: string, messageId: string) =>
        request<{ pin: PinnedMessage }>('POST', `/channels/${id}/pins`, { messageId }),
      unpinMessage: (id: string, messageId: string) =>
        request<{ success: boolean }>('DELETE', `/channels/${id}/pins/${messageId}`),
      getOverrides: (channelId: string) =>
        request<{ channelId: string; targetType: string; targetId: string; allow: string; deny: string; version?: string }[]>(
          'GET', `/channels/${channelId}/overrides`
        ),
      putOverride: (channelId: string, data: OverrideWriteBody) =>
        request<{ success: boolean; version?: string }>('PUT', `/channels/${channelId}/overrides`, data),
      deleteOverride: (channelId: string, targetType: string, targetId: string, version?: string) =>
        request<{ success: boolean }>('DELETE', `/channels/${channelId}/overrides/${targetType}/${targetId}${versionQuery(version)}`),
      updateLayout: (spaceId: string, data: { channels: Array<{ id: string; position: number; categoryId: string | null }>; categories: Array<{ id: string; position: number }> }) =>
        request<{ success: boolean }>('PATCH', `/spaces/${spaceId}/channel-layout`, data),
    };

    this.categories = {
      create: (spaceId: string, name: string) =>
        request<ChannelCategory>('POST', `/spaces/${spaceId}/categories`, { name }),
      update: (id: string, data: { name?: string; position?: number }) =>
        request<ChannelCategory>('PATCH', `/categories/${id}`, data),
      delete: (id: string) =>
        request<{ success: boolean }>('DELETE', `/categories/${id}`),
      getOverrides: (categoryId: string) =>
        request<{ categoryId: string; targetType: string; targetId: string; allow: string; deny: string; version?: string }[]>(
          'GET', `/categories/${categoryId}/overrides`
        ),
      putOverride: (categoryId: string, data: OverrideWriteBody) =>
        request<{ success: boolean; version?: string }>('PUT', `/categories/${categoryId}/overrides`, data),
      deleteOverride: (categoryId: string, targetType: string, targetId: string, version?: string) =>
        request<{ success: boolean }>('DELETE', `/categories/${categoryId}/overrides/${targetType}/${targetId}${versionQuery(version)}`),
    };

    this.messages = {
      update: (id: string, data: UpdateMessageRequest) => request<MessageWithUser>('PATCH', `/messages/${id}`, data),
      delete: (id: string) => request<{ success: boolean }>('DELETE', `/messages/${id}`),
    };

    this.uploads = {
      url: (filename: string) => `${baseUrl}/uploads/${filename}`,
    };

    this.dm = {
      list: () => request<DmChannel[]>('GET', '/dm'),
      create: (data: CreateDmRequest) => request<DmChannel>('POST', '/dm', data),
      createGroup: (data: CreateGroupDmRequest) => request<DmChannel>('POST', '/dm/group', data),
      close: (id: string) => request<{ success: boolean }>('DELETE', `/dm/${id}`),
      messages: (id: string, before?: string, limit = 50) => {
        const params = new URLSearchParams();
        if (before) params.set('before', before);
        params.set('limit', String(limit));
        return request<DmMessageWithUser[]>('GET', `/dm/${id}/messages?${params}`);
      },
      messagesAfter: (id: string, after: string, limit = 50) =>
        historyAfter<DmMessageWithUser>(`/dm/${id}/messages`, after, limit),
      messagesAround: (id: string, messageId: string, limit = 50) => {
        const params = new URLSearchParams();
        params.set('messageId', messageId);
        params.set('limit', String(limit));
        return request<DmMessageWithUser[]>('GET', `/dm/${id}/messages/around?${params}`);
      },
      sendMessage: (id: string, data: CreateDmMessageRequest) =>
        request<DmMessageWithUser>('POST', `/dm/${id}/messages`, data),
      sendMessageReceipt: (id: string, data: CreateDmMessageRequest) =>
        messageReceipt(`/dm/${id}/messages`, data),
      updateMessage: (id: string, data: UpdateMessageRequest) =>
        request<DmMessageWithUser>('PATCH', `/dm/messages/${id}`, data),
      deleteMessage: (id: string) =>
        request<{ success: boolean }>('DELETE', `/dm/messages/${id}`),
      addMember: (dmChannelId: string, data: AddDmMemberRequest) =>
        request<DmChannel>('POST', `/dm/${dmChannelId}/members`, data),
      leave: (dmChannelId: string) =>
        request<{ success: boolean }>('DELETE', `/dm/${dmChannelId}/members`),
      updateMetadata: (channelId, body) =>
        request<DmChannel>('PATCH', `/dm/${encodeURIComponent(channelId)}`, body),
      kickMember: (channelId, userId) => request<{ success: boolean }>('DELETE', `/dm/${encodeURIComponent(channelId)}/members/${encodeURIComponent(userId)}`),
      transferOwnership: (channelId, body) => request<DmChannel>('POST', `/dm/${encodeURIComponent(channelId)}/transfer`, body),
      spaceInvite: (body) =>
        request<SpaceInviteResponse>('POST', '/dm/space-invite', body),
    };

    this.social = {
      friends: () => request<Friend[]>('GET', '/social/friends'),
      requests: () => request<FriendRequest[]>('GET', '/social/requests'),
      sendRequest: (body: SendFriendRequest) => request<{ success: boolean; requestId?: string }>('POST', '/social/requests', body),
      updateRequest: (id: string, status: 'accepted' | 'declined') =>
        request<{ success: boolean }>('PATCH', `/social/requests/${id}`, { status }),
      removeFriend: (id: string) => request<{ success: boolean }>('DELETE', `/social/friends/${id}`),
      cancelRequest: (id: string) => request<{ success: boolean }>('DELETE', `/social/requests/${id}`),
      search: (q: string) => request<User[]>('GET', `/social/search?q=${encodeURIComponent(q)}`),
      discover: (q?: string, limit = 24, offset = 0) => {
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        params.set('limit', String(limit));
        params.set('offset', String(offset));
        return request<{ users: DiscoverUser[]; total: number }>('GET', `/social/discover?${params}`);
      },
    };

    this.livekit = {
      token: (channelId: string) =>
        request<LiveKitTokenResponse>('POST', '/livekit/token', { channelId }),
      dmToken: (dmChannelId: string) =>
        request<LiveKitTokenResponse>('POST', '/livekit/token', { dmChannelId }),
    };

    this.settings = {
      getStreaming: () => request<InstanceStreamingLimits>('GET', '/settings/streaming'),
      updateStreaming: (data: Partial<InstanceStreamingLimits>) =>
        request<InstanceStreamingLimits>('PATCH', '/settings/streaming', data),
      getInstance: () => request<InstanceAdminSettings>('GET', '/settings/instance'),
      updateInstance: (data: Partial<InstanceAdminSettings>) =>
        request<InstanceAdminSettings>('PATCH', '/settings/instance', data),
    };

    this.instance = {
      info: () => request<InstanceInfoResponse>('GET', '/instance/info', undefined, false),
    };

    this.roles = {
      create: (spaceId: string, data: { name: string; color?: string; permissions?: string }) =>
        request<Role>('POST', `/spaces/${spaceId}/roles`, data),
      update: (spaceId: string, roleId: string, data: RoleUpdateBody) =>
        request<Role>('PATCH', `/spaces/${spaceId}/roles/${roleId}`, data),
      delete: (spaceId: string, roleId: string) =>
        request<{ success: boolean }>('DELETE', `/spaces/${spaceId}/roles/${roleId}`),
    };

    this.search = {
      channel: (channelId: string, params: { q?: string; from?: string; has?: string; before?: string; after?: string; offset?: number; limit?: number }) => {
        const qs = new URLSearchParams();
        if (params.q) qs.set('q', params.q);
        if (params.from) qs.set('from', params.from);
        if (params.has) qs.set('has', params.has);
        if (params.before) qs.set('before', params.before);
        if (params.after) qs.set('after', params.after);
        if (params.offset !== undefined) qs.set('offset', String(params.offset));
        if (params.limit !== undefined) qs.set('limit', String(params.limit));
        return request<{ results: MessageWithUser[]; totalCount: number }>('GET', `/channels/${channelId}/search?${qs}`);
      },
      dm: (dmChannelId: string, params: { q?: string; from?: string; has?: string; before?: string; after?: string; offset?: number; limit?: number }) => {
        const qs = new URLSearchParams();
        if (params.q) qs.set('q', params.q);
        if (params.from) qs.set('from', params.from);
        if (params.has) qs.set('has', params.has);
        if (params.before) qs.set('before', params.before);
        if (params.after) qs.set('after', params.after);
        if (params.offset !== undefined) qs.set('offset', String(params.offset));
        if (params.limit !== undefined) qs.set('limit', String(params.limit));
        return request<{ results: DmMessageWithUser[]; totalCount: number }>('GET', `/dm/${dmChannelId}/search?${qs}`);
      },
    };

    this.joinRequests = {
      request: (spaceId: string, message?: string) =>
        request<JoinRequest>('POST', `/spaces/${spaceId}/request-join`, message ? { message } : {}),
      list: (spaceId: string, status?: string) => {
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        return request<{ requests: JoinRequest[] }>('GET', `/spaces/${spaceId}/join-requests?${params}`);
      },
      decide: (spaceId: string, requestId: string, action: 'accept' | 'decline') =>
        request<JoinRequest>('PATCH', `/spaces/${spaceId}/join-requests/${requestId}`, { action }),
      mine: (status?: string) => {
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        return request<{ requests: JoinRequest[] }>('GET', `/users/@me/join-requests?${params}`);
      },
    };

    this.gif = {
      trending: (limit = 30, pos?: string) => {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        if (pos) params.set('pos', pos);
        return request<{ results: GifResult[]; next: string }>('GET', `/gif/trending?${params}`);
      },
      search: (q: string, limit = 30, pos?: string) => {
        const params = new URLSearchParams();
        params.set('q', q);
        params.set('limit', String(limit));
        if (pos) params.set('pos', pos);
        return request<{ results: GifResult[]; next: string }>('GET', `/gif/search?${params}`);
      },
      enabled: () => request<{ enabled: boolean }>('GET', '/gif/enabled'),
    };

    this.commands = {
      forChat: (target: { channelId?: string; dmChannelId?: string }) => {
        const params = new URLSearchParams();
        if (target.channelId) params.set('channelId', target.channelId);
        if (target.dmChannelId) params.set('dmChannelId', target.dmChannelId);
        return request<ChatCommandsResponse>('GET', `/commands?${params.toString()}`);
      },
      invoke: (body: CreateInteractionRequest) => request<CreateInteractionResponse>('POST', '/interactions', body),
    };

    this.bots = {
      list: () => request<{ bots: BotSummary[] }>('GET', '/bots'),
      search: (q: string) => request<{ bots: BotSearchResult[] }>('GET', `/bots/search?q=${encodeURIComponent(q)}`),
      create: (data: CreateBotRequest) => request<CreateBotResponse>('POST', '/bots', data),
      regenerateToken: (id: string) => request<RegenerateBotTokenResponse>('POST', `/bots/${id}/token`),
      listTokens: (id: string) => request<BotTokensResponse>('GET', `/bots/${id}/tokens`),
      createToken: (id: string, data: CreateBotTokenRequest) => request<CreateBotTokenResponse>('POST', `/bots/${id}/tokens`, data),
      revokeToken: (id: string, tokenId: string) => request<{ success: boolean }>('DELETE', `/bots/${id}/tokens/${tokenId}`),
      update: (id: string, data: UpdateBotRequest) => request<UpdateBotResponse>('PATCH', `/bots/${id}`, data),
      spaces: (id: string) => request<BotSpacesResponse>('GET', `/bots/${id}/spaces`),
      addToSpace: (id: string, spaceId: string, permissions?: string) => request<{ success: boolean }>('POST', `/bots/${id}/spaces`, permissions === undefined ? { spaceId } : { spaceId, permissions }),
      removeFromSpace: (id: string, spaceId: string) => request<{ success: boolean }>('DELETE', `/bots/${id}/spaces/${spaceId}`),
      delete: (id: string) => request<{ success: boolean }>('DELETE', `/bots/${id}`),
    };

    this.invites = {
      list: (status: 'active' | 'archived' = 'active') =>
        request<{ invites: InviteLinkSummary[] }>('GET', `/admin/invites?status=${status}`),
      create: (body: CreateInviteRequest) =>
        request<InviteLinkSummary>('POST', '/admin/invites', body),
      update: (id: string, body: UpdateInviteRequest) =>
        request<InviteLinkSummary>('PATCH', `/admin/invites/${id}`, body),
      revoke: (id: string) =>
        request<{ invite: InviteLinkSummary }>('POST', `/admin/invites/${id}/revoke`),
      reinstate: (id: string, body: ReinstateInviteRequest) =>
        request<ReinstateInviteResponse>('POST', `/admin/invites/${id}/reinstate`, body),
      delete: (id: string) =>
        request<{ success: boolean }>('DELETE', `/admin/invites/${id}`),
      redemptions: (id: string) =>
        request<{ redemptions: InviteRedemption[] }>('GET', `/admin/invites/${id}/redemptions`),
    };

    this.admin = {
      storageStats: () => request<StorageStats>('GET', '/admin/storage/stats'),
      storageOrphans: () => request<{ orphans: OrphanedFile[] }>('GET', '/admin/storage/orphans'),
      storageCleanup: (dryRun = false) => request<CleanupResult>('POST', '/admin/storage/cleanup', { dryRun }),
      cleanupOldMedia: (maxAgeDays: number, dryRun = false) =>
        request<CleanupResult>('POST', '/admin/storage/cleanup-media', { maxAgeDays, dryRun }),
      cleanupTusSessions: (maxAgeHours: number, dryRun = false) =>
        request<CleanupResult>('POST', '/admin/storage/cleanup-tus', { maxAgeHours, dryRun }),
      listUsers: (params) => {
        const qs = new URLSearchParams();
        if (params?.q) qs.set('q', params.q);
        if (params?.page !== undefined) qs.set('page', String(params.page));
        if (params?.pageSize !== undefined) qs.set('pageSize', String(params.pageSize));
        if (params?.showDeleted) qs.set('showDeleted', 'true');
        if (params?.role) qs.set('role', params.role);
        if (params?.joinedAfter) qs.set('joinedAfter', params.joinedAfter);
        if (params?.joinedBefore) qs.set('joinedBefore', params.joinedBefore);
        if (params?.sort) qs.set('sort', params.sort);
        return request<AdminUserListResponse>('GET', `/admin/users?${qs}`);
      },
      setUserRole: (userId, isAdmin) =>
        request<AdminUser>('PATCH', `/admin/users/${userId}/role`, { isAdmin }),
      resetUserPassword: (userId) =>
        request<AdminResetPasswordResponse>('POST', `/admin/users/${userId}/reset-password`),
      deleteUser: userId => request<{ success: boolean }>('DELETE', `/admin/users/${encodeURIComponent(userId)}`),
      // `refresh` bypasses the server's six-hour cache for an explicit
      // "Check again" click. It cannot bypass BACKSPACE_UPDATE_CHECK.
      updateStatus: (refresh = false) =>
        request<InstanceUpdateStatus>(
          'GET',
          `/admin/instance/update-status${refresh ? '?refresh=true' : ''}`,
        ),
      stickerPacks: {
        listReviews: () => request<StickerPackSummary[]>('GET', '/admin/sticker-packs/reviews'),
        approve: (id: string) => request<{ success: boolean; status: string }>('POST', `/admin/sticker-packs/${encodeURIComponent(id)}/approve`),
        reject: (id: string, reviewNotes?: string) => request<{ success: boolean; status: string }>('POST', `/admin/sticker-packs/${encodeURIComponent(id)}/reject`, { reviewNotes }),
        listAll: (params?: { status?: string; q?: string }) => {
          const qs = new URLSearchParams();
          if (params?.status) qs.set('status', params.status);
          if (params?.q) qs.set('q', params.q);
          return request<StickerPackSummary[]>('GET', `/admin/sticker-packs${qs.toString() ? `?${qs}` : ''}`);
        },
        setStatus: (id: string, status: string) => request<{ success: boolean; status: string }>('POST', `/admin/sticker-packs/${encodeURIComponent(id)}/status`, { status }),
      },
    };

  }
}

function handleUnauthorized(): void {
  api.cancelPendingReads();
  localStorage.removeItem('backspace_token');
  if (
    !window.location.pathname.startsWith('/login') &&
    !window.location.pathname.startsWith('/register')
  ) {
    window.location.href = '/login';
  }
}

export const api = new VeyvoxApiClient(
  '/api',
  () => localStorage.getItem('backspace_token'),
  handleUnauthorized,
);

export function createApiClient(origin: string, getToken: () => string | null, onUnauthorized?: () => void): VeyvoxApiClient {
  const baseUrl = origin ? `${origin}/api` : '/api';
  return new VeyvoxApiClient(baseUrl, getToken, onUnauthorized);
}

