import { createHash, randomBytes, randomUUID } from 'node:crypto';

// eslint-disable-next-line import/default
import bcrypt from 'bcryptjs';
// eslint-disable-next-line import/default
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { ErrorCodes } from '@app/shared';

import { AppError } from '../lib/errors.js';
import { prisma, type DbClient } from '../lib/db.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BCRYPT_ROUNDS = 12; // SPEC §9 — bcrypt cost ≥ 12
const GRACE_WINDOW_SECONDS = 10; // SPEC §9 — network-retry tolerance
const JWT_ALGORITHM = 'HS256' as const;
const JWT_SECRET_MIN_LENGTH = 48; // ~256-bit entropy in base64url

// AuthErrorCodes (legacy local enum) was replaced by the shared ErrorCodes
// module. Re-export under the old name for any consumer that still imports
// it (FE auth feature) until those imports migrate too.
export { ErrorCodes as AuthErrorCodes };

function getAccessTtlSeconds(): number {
  return Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900);
}

function getRefreshTtlMs(): number {
  return Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30) * 86_400_000;
}

function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < JWT_SECRET_MIN_LENGTH) {
    throw new AppError(
      ErrorCodes.CONFIG_ERROR,
      `JWT_SECRET missing or shorter than ${JWT_SECRET_MIN_LENGTH} chars`,
      500,
    );
  }
  return s;
}

export type { DbClient };

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ---------------------------------------------------------------------------
// Access token (JWT, 15 min)
// ---------------------------------------------------------------------------

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  iat: number;
  exp: number;
}

export function issueAccessToken(user: { id: string; role: Role }): string {
  return jwt.sign({ sub: user.id, role: user.role }, getJwtSecret(), {
    expiresIn: getAccessTtlSeconds(),
    algorithm: JWT_ALGORITHM,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, getJwtSecret(), {
      // Whitelist explicitly — defense against future alg-confusion if anyone
      // ever changes how access tokens are issued.
      algorithms: [JWT_ALGORITHM],
    }) as AccessTokenPayload;
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) {
      throw new AppError(ErrorCodes.TOKEN_EXPIRED, 'Access token expired', 401);
    }
    throw new AppError(ErrorCodes.INVALID_TOKEN, 'Access token invalid', 401);
  }
}

// ---------------------------------------------------------------------------
// Refresh token (opaque, DB stores SHA-256 hash only)
// ---------------------------------------------------------------------------

export interface RefreshContext {
  userAgent?: string | null;
  ip?: string | null;
}

export interface IssuedRefreshToken {
  /** Plaintext token, returned to the client ONCE — never stored in DB. */
  plain: string;
  familyId: string;
  expiresAt: Date;
}

function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

interface IssueOpts {
  familyId?: string;
  parentId?: string | null;
}

export async function issueRefreshToken(
  db: DbClient,
  userId: string,
  ctx: RefreshContext = {},
  opts: IssueOpts = {},
): Promise<IssuedRefreshToken> {
  const plain = generateOpaqueToken();
  const tokenHash = hashToken(plain);
  const familyId = opts.familyId ?? randomUUID();
  const expiresAt = new Date(Date.now() + getRefreshTtlMs());

  await db.refreshToken.create({
    data: {
      userId,
      familyId,
      tokenHash,
      parentId: opts.parentId ?? null,
      expiresAt,
      userAgent: ctx.userAgent ?? null,
      ip: ctx.ip ?? null,
    },
  });

  return { plain, familyId, expiresAt };
}

// ---------------------------------------------------------------------------
// Rotation (with grace window + reuse detection)
// ---------------------------------------------------------------------------

export interface RotateResult {
  user: { id: string; email: string; role: Role };
  accessToken: string;
  refresh: IssuedRefreshToken;
}

/**
 * Verify a refresh token and rotate it for a new pair.
 *
 * MUST be called inside an outer `prisma.$transaction` (routes wrap it, tests
 * wrap it via withTestTx). Reasoning: revoke-old + insert-new must be atomic.
 *
 * Branches:
 *  - happy path  → revoke old, insert new linked by parentId, return new pair
 *  - expired     → 401 TOKEN_EXPIRED
 *  - unknown     → 401 INVALID_TOKEN
 *  - revoked but grace-eligible → revoke whatever orphan latest exists, issue
 *      a fresh token in the same family, return new pair. Eligibility: the
 *      incoming token must be the immediate parent of the family's current
 *      valid latest, and revocation happened within GRACE_WINDOW_SECONDS.
 *  - revoked, not grace → revoke ENTIRE family, throw 401 TOKEN_REUSED
 */
export async function rotateRefreshToken(
  db: DbClient,
  plain: string,
  ctx: RefreshContext = {},
): Promise<RotateResult> {
  const tokenHash = hashToken(plain);

  const existing = await db.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!existing) {
    throw new AppError(ErrorCodes.INVALID_TOKEN, 'Refresh token not found', 401);
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw new AppError(ErrorCodes.TOKEN_EXPIRED, 'Refresh token expired', 401);
  }

  if (existing.revokedAt) {
    // Could be grace-window retry OR a reuse attack
    const latest = await db.refreshToken.findFirst({
      where: { familyId: existing.familyId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const isImmediateParent = latest?.parentId === existing.id;
    const withinWindow = Date.now() - existing.revokedAt.getTime() <= GRACE_WINDOW_SECONDS * 1000;

    if (latest && isImmediateParent && withinWindow) {
      // Grace path — supersede the orphan latest, issue a fresh token.
      // Conditional updateMany so a concurrent rotation racing to revoke the
      // same `latest` row makes us bail out instead of double-issuing.
      const revoked = await db.refreshToken.updateMany({
        where: { id: latest.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count === 0) {
        throw new AppError(ErrorCodes.TOKEN_RACED, 'Concurrent rotation during grace; retry', 409);
      }
      const refresh = await issueRefreshToken(db, existing.userId, ctx, {
        familyId: existing.familyId,
        parentId: existing.id,
      });
      const accessToken = issueAccessToken(existing.user);
      return {
        user: { id: existing.user.id, email: existing.user.email, role: existing.user.role },
        accessToken,
        refresh,
      };
    }

    // Reuse detection — torch the whole family, sibling families untouched.
    // updateMany w/ `revokedAt: null` filter is already race-safe (concurrent
    // detection just no-ops on the second caller).
    await db.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AppError(ErrorCodes.TOKEN_REUSED, 'Refresh token reuse detected', 401);
  }

  // Happy path — optimistic lock via conditional updateMany. If a concurrent
  // rotation revoked this token between our find and our update, count=0 and
  // we bail with TOKEN_RACED instead of silently issuing two valid pairs.
  const revoked = await db.refreshToken.updateMany({
    where: { id: existing.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (revoked.count === 0) {
    throw new AppError(
      ErrorCodes.TOKEN_RACED,
      'Concurrent rotation detected; retry with current token',
      409,
    );
  }
  const refresh = await issueRefreshToken(db, existing.userId, ctx, {
    familyId: existing.familyId,
    parentId: existing.id,
  });
  const accessToken = issueAccessToken(existing.user);

  return {
    user: { id: existing.user.id, email: existing.user.email, role: existing.user.role },
    accessToken,
    refresh,
  };
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

export async function revokeFamily(db: DbClient, familyId: string): Promise<number> {
  const r = await db.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return r.count;
}

/** Logout: revoke the single refresh token. Idempotent. */
export async function revokeRefreshToken(db: DbClient, plain: string): Promise<boolean> {
  const tokenHash = hashToken(plain);
  const r = await db.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return r.count > 0;
}

// ---------------------------------------------------------------------------
// Cleanup (used by background cron — exposed for testability)
// ---------------------------------------------------------------------------

/** Delete tokens that are expired OR have been revoked for >= 30 days. */
export async function cleanupExpiredTokens(db: DbClient = prisma): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 86_400_000);
  const r = await db.refreshToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }],
    },
  });
  return r.count;
}
