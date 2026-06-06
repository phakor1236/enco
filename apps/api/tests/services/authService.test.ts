import { createHash } from 'node:crypto';

// eslint-disable-next-line import/default
import jwt from 'jsonwebtoken';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../src/lib/db.js';
import { AppError } from '../../src/lib/errors.js';
import {
  cleanupExpiredTokens,
  hashPassword,
  issueAccessToken,
  issueRefreshToken,
  revokeFamily,
  revokeRefreshToken,
  rotateRefreshToken,
  verifyAccessToken,
  verifyPassword,
} from '../../src/services/authService.js';
import { withTestTx } from '../helpers/withTestTx.js';

afterAll(async () => {
  await prisma.$disconnect();
});

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// ============================================================================
// Passwords
// ============================================================================

describe('hashPassword / verifyPassword', () => {
  it('produces a bcrypt hash that verifies the original plaintext', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$2[aby]\$12\$/); // bcrypt, cost 12
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('right');
    await expect(verifyPassword('wrong', hash)).resolves.toBe(false);
  });
});

// ============================================================================
// Access token (JWT)
// ============================================================================

describe('issueAccessToken / verifyAccessToken', () => {
  it('round-trips sub + role', () => {
    const token = issueAccessToken({ id: 'u-1', role: 'CUSTOMER' });
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('u-1');
    expect(payload.role).toBe('CUSTOMER');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('rejects a tampered token with INVALID_TOKEN', () => {
    const token = issueAccessToken({ id: 'u-1', role: 'ADMIN' });
    const tampered = token.slice(0, -4) + 'XXXX';
    expect(() => verifyAccessToken(tampered)).toThrow(AppError);
    try {
      verifyAccessToken(tampered);
    } catch (e) {
      expect((e as AppError).code).toBe('INVALID_TOKEN');
    }
  });

  it('reports TOKEN_EXPIRED for an expired JWT', () => {
    // Forge a token that's already expired (1s TTL, signed manually)
    const expired = jwt.sign({ sub: 'u-1', role: 'CUSTOMER' }, process.env.JWT_SECRET as string, {
      expiresIn: -1,
    });
    try {
      verifyAccessToken(expired);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as AppError).code).toBe('TOKEN_EXPIRED');
    }
  });
});

// ============================================================================
// Refresh token — issue
// ============================================================================

describe('issueRefreshToken', () => {
  it('stores SHA-256 hash, never plaintext', async () => {
    await withTestTx(async (tx) => {
      const user = await tx.user.create({
        data: { email: 'i1@vella.test', passwordHash: 'x' },
      });
      const issued = await issueRefreshToken(tx, user.id, { ip: '1.1.1.1', userAgent: 'ua' });

      const row = await tx.refreshToken.findUnique({ where: { tokenHash: sha256(issued.plain) } });
      expect(row).not.toBeNull();
      expect(row?.userId).toBe(user.id);
      expect(row?.ip).toBe('1.1.1.1');
      expect(row?.userAgent).toBe('ua');
      // Critical: the plain token must NOT appear anywhere in DB
      const leak = await tx.refreshToken.findFirst({
        where: { tokenHash: { contains: issued.plain.slice(0, 20) } },
      });
      expect(leak).toBeNull();
    });
  });

  it('assigns a new family + expiresAt ~30 days out for a fresh token', async () => {
    await withTestTx(async (tx) => {
      const user = await tx.user.create({ data: { email: 'i2@vella.test', passwordHash: 'x' } });
      const issued = await issueRefreshToken(tx, user.id);
      expect(issued.familyId).toHaveLength(36); // uuid v4
      const daysUntilExpiry = (issued.expiresAt.getTime() - Date.now()) / 86_400_000;
      expect(daysUntilExpiry).toBeGreaterThan(29);
      expect(daysUntilExpiry).toBeLessThanOrEqual(30);
    });
  });
});

// ============================================================================
// Rotation — happy path + chain
// ============================================================================

describe('rotateRefreshToken — happy path', () => {
  it('issues a new pair, revokes the old token, links via parent_id, keeps family', async () => {
    await withTestTx(async (tx) => {
      const user = await tx.user.create({ data: { email: 'r1@vella.test', passwordHash: 'x' } });
      const first = await issueRefreshToken(tx, user.id);

      const rotated = await rotateRefreshToken(tx, first.plain);

      expect(rotated.user.id).toBe(user.id);
      expect(rotated.accessToken).toBeTruthy();
      expect(rotated.refresh.plain).not.toBe(first.plain);
      expect(rotated.refresh.familyId).toBe(first.familyId);

      const old = await tx.refreshToken.findUnique({ where: { tokenHash: sha256(first.plain) } });
      expect(old?.revokedAt).not.toBeNull();

      const fresh = await tx.refreshToken.findUnique({
        where: { tokenHash: sha256(rotated.refresh.plain) },
      });
      expect(fresh?.revokedAt).toBeNull();
      expect(fresh?.parentId).toBe(old?.id);
      expect(fresh?.familyId).toBe(first.familyId);
    });
  });
});

// ============================================================================
// Rotation — error branches
// ============================================================================

describe('rotateRefreshToken — error paths', () => {
  it('throws INVALID_TOKEN for an unknown plaintext', async () => {
    await withTestTx(async (tx) => {
      try {
        await rotateRefreshToken(tx, 'definitely-not-a-real-token');
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as AppError).code).toBe('INVALID_TOKEN');
        expect((e as AppError).status).toBe(401);
      }
    });
  });

  it('throws TOKEN_EXPIRED for a past expiry', async () => {
    await withTestTx(async (tx) => {
      const user = await tx.user.create({ data: { email: 'r2@vella.test', passwordHash: 'x' } });
      const issued = await issueRefreshToken(tx, user.id);
      // Backdate expiry directly
      await tx.refreshToken.update({
        where: { tokenHash: sha256(issued.plain) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      try {
        await rotateRefreshToken(tx, issued.plain);
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as AppError).code).toBe('TOKEN_EXPIRED');
      }
    });
  });
});

// ============================================================================
// Reuse detection
// ============================================================================

describe('rotateRefreshToken — reuse detection', () => {
  it('revokes the entire family when a stale (older-than-grace) revoked token is replayed', async () => {
    await withTestTx(async (tx) => {
      const user = await tx.user.create({ data: { email: 'reuse@vella.test', passwordHash: 'x' } });
      const t1 = await issueRefreshToken(tx, user.id);
      const r1 = await rotateRefreshToken(tx, t1.plain); // t1 -> t2
      const r2 = await rotateRefreshToken(tx, r1.refresh.plain); // t2 -> t3
      // Now t1 and t2 are revoked, t3 is active.
      // Backdate t1's revokedAt so it's outside the grace window
      await tx.refreshToken.update({
        where: { tokenHash: sha256(t1.plain) },
        data: { revokedAt: new Date(Date.now() - 60_000) },
      });

      // Replay t1 → reuse detection fires
      await expect(rotateRefreshToken(tx, t1.plain)).rejects.toThrow();
      try {
        await rotateRefreshToken(tx, t1.plain);
      } catch (e) {
        expect((e as AppError).code).toBe('TOKEN_REUSED');
      }

      // All tokens in the family (t1, t2, t3) revoked
      const familyAlive = await tx.refreshToken.findMany({
        where: { familyId: t1.familyId, revokedAt: null },
      });
      expect(familyAlive).toHaveLength(0);

      // Sibling family unrelated — confirm by issuing a separate family for same user
      const sibling = await issueRefreshToken(tx, user.id);
      const stillThere = await tx.refreshToken.findUnique({
        where: { tokenHash: sha256(sibling.plain) },
      });
      expect(stillThere?.revokedAt).toBeNull();
      // r2.refresh exists in same family as t1; already revoked above. Confirm.
      void r2;
    });
  });
});

// ============================================================================
// Grace window
// ============================================================================

describe('rotateRefreshToken — grace window', () => {
  it('accepts the immediate-parent token within 10s post-rotation (network retry)', async () => {
    await withTestTx(async (tx) => {
      const user = await tx.user.create({ data: { email: 'grace@vella.test', passwordHash: 'x' } });
      const t1 = await issueRefreshToken(tx, user.id);
      const r1 = await rotateRefreshToken(tx, t1.plain); // t1 → t2 (t1 just revoked ~now)

      // Replay t1 — should be grace-handled, NOT treated as reuse
      const r2 = await rotateRefreshToken(tx, t1.plain);

      expect(r2.user.id).toBe(user.id);
      expect(r2.refresh.familyId).toBe(t1.familyId);
      expect(r2.refresh.plain).not.toBe(r1.refresh.plain);

      // r1.refresh (the orphan latest) should be revoked by the grace path
      const orphan = await tx.refreshToken.findUnique({
        where: { tokenHash: sha256(r1.refresh.plain) },
      });
      expect(orphan?.revokedAt).not.toBeNull();

      // r2.refresh is the active one
      const active = await tx.refreshToken.findUnique({
        where: { tokenHash: sha256(r2.refresh.plain) },
      });
      expect(active?.revokedAt).toBeNull();
    });
  });

  it('rejects replay AFTER grace window expires (revokedAt aged > 10s)', async () => {
    await withTestTx(async (tx) => {
      const user = await tx.user.create({ data: { email: 'gpast@vella.test', passwordHash: 'x' } });
      const t1 = await issueRefreshToken(tx, user.id);
      await rotateRefreshToken(tx, t1.plain); // t1 revoked now

      // Age t1's revokedAt past the window
      await tx.refreshToken.update({
        where: { tokenHash: sha256(t1.plain) },
        data: { revokedAt: new Date(Date.now() - 11_000) },
      });

      try {
        await rotateRefreshToken(tx, t1.plain);
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as AppError).code).toBe('TOKEN_REUSED');
      }
    });
  });

  it('treats a non-immediate-parent stale token as reuse (even within window)', async () => {
    await withTestTx(async (tx) => {
      const user = await tx.user.create({ data: { email: 'gskip@vella.test', passwordHash: 'x' } });
      const t1 = await issueRefreshToken(tx, user.id);
      const r1 = await rotateRefreshToken(tx, t1.plain); // t1 → t2
      await rotateRefreshToken(tx, r1.refresh.plain); // t2 → t3
      // Now t1 is grandparent, not immediate parent of latest (t3)

      try {
        await rotateRefreshToken(tx, t1.plain);
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as AppError).code).toBe('TOKEN_REUSED');
      }
    });
  });
});

// ============================================================================
// Revocation
// ============================================================================

describe('revokeFamily', () => {
  it('revokes only the named family, not sibling families of the same user', async () => {
    await withTestTx(async (tx) => {
      const user = await tx.user.create({ data: { email: 'rf@vella.test', passwordHash: 'x' } });
      const famA = await issueRefreshToken(tx, user.id);
      const famB = await issueRefreshToken(tx, user.id);
      expect(famA.familyId).not.toBe(famB.familyId);

      const count = await revokeFamily(tx, famA.familyId);
      expect(count).toBe(1);

      const a = await tx.refreshToken.findUnique({ where: { tokenHash: sha256(famA.plain) } });
      const b = await tx.refreshToken.findUnique({ where: { tokenHash: sha256(famB.plain) } });
      expect(a?.revokedAt).not.toBeNull();
      expect(b?.revokedAt).toBeNull();
    });
  });
});

describe('revokeRefreshToken (logout)', () => {
  it('revokes the token and is idempotent', async () => {
    await withTestTx(async (tx) => {
      const user = await tx.user.create({ data: { email: 'lo@vella.test', passwordHash: 'x' } });
      const t = await issueRefreshToken(tx, user.id);

      await expect(revokeRefreshToken(tx, t.plain)).resolves.toBe(true);
      // Second call: already revoked, returns false (no rows newly affected)
      await expect(revokeRefreshToken(tx, t.plain)).resolves.toBe(false);

      const row = await tx.refreshToken.findUnique({ where: { tokenHash: sha256(t.plain) } });
      expect(row?.revokedAt).not.toBeNull();
    });
  });
});

// ============================================================================
// Cleanup
// ============================================================================

describe('cleanupExpiredTokens', () => {
  it('removes tokens past expiresAt and tokens revoked > 30 days ago', async () => {
    await withTestTx(async (tx) => {
      const user = await tx.user.create({ data: { email: 'cu@vella.test', passwordHash: 'x' } });
      const fresh = await issueRefreshToken(tx, user.id);
      const expiredIssued = await issueRefreshToken(tx, user.id);
      const oldRevokedIssued = await issueRefreshToken(tx, user.id);

      await tx.refreshToken.update({
        where: { tokenHash: sha256(expiredIssued.plain) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await tx.refreshToken.update({
        where: { tokenHash: sha256(oldRevokedIssued.plain) },
        data: { revokedAt: new Date(Date.now() - 31 * 86_400_000) },
      });

      const removed = await cleanupExpiredTokens(tx);
      expect(removed).toBe(2);

      const left = await tx.refreshToken.findUnique({
        where: { tokenHash: sha256(fresh.plain) },
      });
      expect(left).not.toBeNull();
    });
  });
});

// ============================================================================
// Config guard
// ============================================================================

describe('JWT secret guard', () => {
  it('throws CONFIG_ERROR when JWT_SECRET is missing', () => {
    const orig = process.env.JWT_SECRET;
    vi.stubEnv('JWT_SECRET', '');
    try {
      issueAccessToken({ id: 'u', role: 'CUSTOMER' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as AppError).code).toBe('CONFIG_ERROR');
    } finally {
      vi.stubEnv('JWT_SECRET', orig as string);
    }
  });
});
