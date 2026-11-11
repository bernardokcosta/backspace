import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { hashPassword, verifyPassword, signJwt } from '../utils/auth.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { config } from '../config.js';
import type { RegisterRequest, LoginRequest, AuthResponse } from '@veyvox/shared';
import { AVATAR_COLORS } from '@veyvox/shared';
import { PASSWORD_MIN_LENGTH } from '@veyvox/shared/src/constants.js';
import { sanitizeUser } from '../utils/sanitize.js';
import { getInviteByToken, inviteStatus, redeemInvite, InviteUnavailableError } from '../utils/inviteService.js';
import { sendError, errorText } from '../utils/httpErrors.js';
import type { ErrorCode, ErrorDetails } from '@veyvox/shared/src/errors';
import { clientAddressKey } from '../utils/httpRateLimit.js';
import { createTokenBucketLimit } from '../utils/tokenBucketLimit.js';
import { sendRateLimit } from '../utils/rateLimits.js';

const USERNAME_MIN = 3;
const USERNAME_MAX = 32;
// Retained account handles may be longer than today's signup limit. Bound the
// login limiter key without changing their local credential lookup.
const LOGIN_KEY_USERNAME_MAX = 100;

/**
 * The availability check answers `{ available, reason }` rather than the
 * error contract, so a client that predates codes keeps working; the code
 * and details ride along for clients that localize.
 */
function unavailable(
  reply: FastifyReply,
  statusCode: number,
  code: ErrorCode,
  details?: ErrorDetails,
): FastifyReply {
  return reply.code(statusCode).send({
    available: false,
    reason: errorText(code, details),
    code,
    ...(details ? { details } : {}),
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const loginAttempts = createTokenBucketLimit({ capacity: 10, refillPerSecond: 1 / 12 });
  app.post<{ Body: RegisterRequest }>('/api/auth/register', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '2 minutes',
        keyGenerator: clientAddressKey,
      },
    },
  }, async (request, reply) => {
    const { username, password, displayName, avatarColor: requestedAvatarColor } = request.body ?? {};

    if (!username || typeof username !== 'string') {
      return sendError(reply, 400, 'username_required');
    }

    if (!password || typeof password !== 'string') {
      return sendError(reply, 400, 'password_required');
    }

    const trimmedUsername = username.trim().toLowerCase();

    if (trimmedUsername.length < USERNAME_MIN || trimmedUsername.length > USERNAME_MAX) {
      return sendError(reply, 400, 'username_length_invalid', { min: USERNAME_MIN, max: USERNAME_MAX });
    }
    if (!/^[a-z0-9_]+$/.test(trimmedUsername)) {
      return sendError(reply, 400, 'username_characters_invalid');
    }

    if (password.length < PASSWORD_MIN_LENGTH) {
      return sendError(reply, 400, 'password_too_short', { min: PASSWORD_MIN_LENGTH });
    }

    const db = getDb();

    // One local admission gate. Admin-explicit settings override the env default.
    const instanceRow = db.select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
    const registrationOpen = instanceRow?.registrationOpen !== null && instanceRow?.registrationOpen !== undefined
      ? instanceRow.registrationOpen === 1
      : config.registrationOpen;
    // Invites are consumed only when registration is closed; open signup ignores them.
    const inviteToken = typeof request.body.inviteToken === 'string'
      ? request.body.inviteToken
      : undefined;

    if (!registrationOpen) {
      if (!inviteToken) return sendError(reply, 403, 'invite_required');
      // Cheap preflight; atomic redemption below revalidates after bcrypt.
      const inviteRow = getInviteByToken(inviteToken);
      if (!inviteRow || inviteStatus(inviteRow) !== 'active') return sendError(reply, 403, 'invite_invalid');
    }


    const passwordHash = await hashPassword(password);

    // Signup always creates a new native human; it never claims another row.
    const existing = db.select().from(schema.users).where(eq(schema.users.username, trimmedUsername)).get();
    if (existing) {
      return sendError(reply, 409, 'username_taken');
    }

    const userId = generateSnowflake();
    const now = Date.now();

    // First registered user becomes instance admin; a submitted flag grants nothing.
    const userCount = db.select().from(schema.users).all().length;
    const isFirstUser = userCount === 0;

    const avatarColor = (requestedAvatarColor && (AVATAR_COLORS as readonly string[]).includes(requestedAvatarColor))
      ? requestedAvatarColor
      : AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    // Note: status is left at the schema default ('offline') and is set to
    // 'online' exclusively by the WebSocket auth path (ws/handler.ts). A
    // successful REST /register does not by itself imply a live connection —
    // the client may never establish a WS (transient network failure, mobile
    // background, error path between this 201 response and /ws connect),
    // which would otherwise produce a permanently stuck-online row that no
    // disconnect timer can clean up. The WS handshake will flip it to
    // 'online' once a real socket attaches.
    const userRow = {
      id: userId,
      username: trimmedUsername,
      displayName: displayName?.trim() || null,
      passwordHash,
      isAdmin: isFirstUser ? 1 : 0,
      avatarColor,
      createdAt: now,
    };

    const consumesInvite = !registrationOpen && !!inviteToken;

    if (consumesInvite) {
      // Atomic redemption: the user INSERT, the usedCount bump, and the
      // invite_redemptions row all run inside one SQLite transaction. If any
      // step throws (token consumed by a concurrent request, username collision
      // bumping into the unique index, etc.) the entire transaction rolls back —
      // we never burn a redemption on a failed registration.
      try {
        redeemInvite(inviteToken!, () => {
          db.insert(schema.users).values(userRow).run();
          return { id: userId, username: trimmedUsername };
        });
      } catch (err) {
        if (err instanceof InviteUnavailableError) {
          // Concurrent revoke / last-slot race / expiry-while-typing all surface here.
          return sendError(reply, 403, 'invite_invalid');
        }
        throw err;
      }
    } else {
      // Open signup does not consume an invitation.
      db.insert(schema.users).values(userRow).run();
    }

    const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!user) {
      return sendError(reply, 500, 'user_create_failed');
    }

    const token = signJwt({ userId: user.id, username: user.username });

    const response: AuthResponse = {
      token,
      user: sanitizeUser(user, true),
    };

    return reply.code(201).send(response);
  });

  app.get<{ Querystring: { username?: string } }>('/api/auth/check-username', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
        keyGenerator: clientAddressKey,
      },
    },
  }, async (request, reply) => {
    const raw = request.query.username;
    if (!raw || typeof raw !== 'string') {
      return unavailable(reply, 400, 'username_required');
    }

    const trimmed = raw.trim().toLowerCase();

    // Format validation (same rules as registration)
    if (trimmed.length < USERNAME_MIN || trimmed.length > USERNAME_MAX) {
      return unavailable(reply, 200, 'username_length_invalid', { min: USERNAME_MIN, max: USERNAME_MAX });
    }
    if (!/^[a-z0-9_]+$/.test(trimmed)) {
      return unavailable(reply, 200, 'username_characters_invalid');
    }

    // Check registration is open
    const db = getDb();
    const instanceRow = db.select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
    const registrationOpen = instanceRow?.registrationOpen !== null && instanceRow?.registrationOpen !== undefined
      ? instanceRow.registrationOpen === 1
      : config.registrationOpen;
    if (!registrationOpen) {
      return unavailable(reply, 403, 'registration_closed');
    }

    const existing = db.select().from(schema.users).where(eq(schema.users.username, trimmed)).get();
    return reply.code(200).send({ available: !existing });
  });

  // Public — used by RegisterPage to debounce-validate invite tokens during
  // typing. The status -> response mapping enforces a "collapsed enumeration
  // shield": revoked, not-found, and malformed tokens all collapse to
  // `'invalid'` so this endpoint can't be used to distinguish them. Only
  // `expired` and `exhausted` surface as themselves because those are
  // legitimate UX hints ("ask the admin to extend it") rather than
  // existence/state leaks. The `name` field is returned ONLY in the valid
  // case — invalid responses must not leak any invite metadata.
  // Status code is always 200; the response body discriminates.
  app.get<{ Querystring: { token?: string } }>('/api/auth/check-invite', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
        keyGenerator: clientAddressKey,
      },
    },
  }, async (request, reply) => {
    const token = request.query.token;
    if (!token || typeof token !== 'string') {
      return reply.code(200).send({ valid: false, reason: 'invalid' });
    }

    // getInviteByToken pre-validates the 22-char base64url shape before
    // hitting the DB; malformed inputs return null here, so the same branch
    // covers both "wrong shape" and "shape ok, not in DB".
    const row = getInviteByToken(token);
    if (!row) {
      return reply.code(200).send({ valid: false, reason: 'invalid' });
    }

    const status = inviteStatus(row);
    if (status === 'active') {
      return reply.code(200).send({ valid: true, name: row.name });
    }
    if (status === 'expired' || status === 'exhausted') {
      return reply.code(200).send({ valid: false, reason: status });
    }
    // status === 'revoked' — collapsed to 'invalid' (no enumeration leak)
    return reply.code(200).send({ valid: false, reason: 'invalid' });
  });

  app.post<{ Body: LoginRequest }>('/api/auth/login', {
    config: {
      rateLimit: {
        max: 120,
        timeWindow: '2 minutes',
        keyGenerator: clientAddressKey,
      },
    },
  }, async (request, reply) => {
    const { username, password } = request.body ?? {};

    if (!username || typeof username !== 'string') {
      return sendError(reply, 400, 'username_required');
    }

    if (!password || typeof password !== 'string') {
      return sendError(reply, 400, 'password_required');
    }

    const normalizedUsername = username.trim().toLowerCase();
    // Reserve before expensive password work; only a verified successful login
    // refunds. Bound attacker-supplied key length without changing account lookup.
    const reservation = loginAttempts.reserve(JSON.stringify([
      clientAddressKey(request), normalizedUsername.slice(0, LOGIN_KEY_USERNAME_MAX + 1),
    ]));
    if (reservation.retryAfterMs > 0) return sendRateLimit(reply, reservation.retryAfterMs, 'action');

    const db = getDb();

    const user = db.select().from(schema.users).where(eq(schema.users.username, normalizedUsername)).get();
    if (!user) {
      return sendError(reply, 401, 'invalid_credentials');
    }

    if (user.isDeleted) {
      return sendError(reply, 401, 'account_deleted');
    }

    const validPassword = await verifyPassword(password, user.passwordHash);
    if (!validPassword) {
      return sendError(reply, 401, 'invalid_credentials');
    }

    // bcrypt yields: a password replacement or account deletion may have
    // committed while this request verified the old snapshot. Authorize only
    // the exact credential epoch that was actually checked, with no await
    // between this read and issuing its token.
    const currentUser = db.select().from(schema.users).where(eq(schema.users.id, user.id)).get();
    if (!currentUser || currentUser.isDeleted) return sendError(reply, 401, 'account_deleted');
    if (currentUser.passwordHash !== user.passwordHash || currentUser.passwordChangedAt !== user.passwordChangedAt) {
      return sendError(reply, 401, 'invalid_credentials');
    }

    // Note: status='online' is set exclusively by the WebSocket auth path
    // (ws/handler.ts). A successful REST /login does not by itself imply a
    // live connection — the client may never establish a WS (transient
    // network failure, mobile background, error path), which would otherwise
    // produce a permanently stuck-online row that no disconnect timer can
    // clean up. The user's reported status remains whatever it was; the WS
    // handshake will flip it to 'online' once a real socket attaches.
    const token = signJwt({ userId: currentUser.id, username: currentUser.username, iat: Math.max(Date.now(), currentUser.passwordChangedAt ?? 0) / 1000 });

    const response: AuthResponse = {
      token,
      user: sanitizeUser(currentUser, true),
    };

    reservation.refund();
    return reply.code(200).send(response);
  });

}
