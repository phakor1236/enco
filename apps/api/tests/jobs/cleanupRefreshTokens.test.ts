import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/db.js';
import { runCleanupRefreshTokens } from '../../src/jobs/cleanupRefreshTokens.js';

/**
 * T7.4 acceptance:
 *   - Tokens with expiresAt > 30 days ago are deleted
 *   - Tokens revoked > 30 days ago are deleted
 *   - Fresh/active tokens are kept
 */

const EMAIL_DOMAIN = 't74-cleanup-tokens.test.internal';
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuv0123456789abcdefghijklmnopqrstuv';

let userId: string;
const createdTokenIds: string[] = [];

beforeAll(async () => {
  const user = await prisma.user.upsert({
    where: { email: `user@${EMAIL_DOMAIN}` },
    update: {},
    create: { email: `user@${EMAIL_DOMAIN}`, passwordHash: DUMMY_HASH },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { id: { in: createdTokenIds } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await prisma.$disconnect();
});

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

async function makeToken(opts: { expiresAt: Date; revokedAt?: Date }) {
  const tok = await prisma.refreshToken.create({
    data: {
      userId,
      familyId: `fam-t74-${Date.now()}-${Math.random()}`,
      tokenHash: `hash-t74-${Date.now()}-${Math.random()}`,
      expiresAt: opts.expiresAt,
      revokedAt: opts.revokedAt ?? null,
    },
  });
  createdTokenIds.push(tok.id);
  return tok;
}

describe('runCleanupRefreshTokens', () => {
  it('deletes tokens expired more than 30 days ago', async () => {
    const stale = await makeToken({ expiresAt: daysAgo(31) });

    await runCleanupRefreshTokens();

    const found = await prisma.refreshToken.findUnique({ where: { id: stale.id } });
    expect(found).toBeNull();
    // Remove from tracking since it's already deleted.
    createdTokenIds.splice(createdTokenIds.indexOf(stale.id), 1);
  });

  it('deletes tokens revoked more than 30 days ago', async () => {
    const stale = await makeToken({ expiresAt: daysAgo(60), revokedAt: daysAgo(31) });

    await runCleanupRefreshTokens();

    const found = await prisma.refreshToken.findUnique({ where: { id: stale.id } });
    expect(found).toBeNull();
    createdTokenIds.splice(createdTokenIds.indexOf(stale.id), 1);
  });

  it('keeps fresh active tokens', async () => {
    const fresh = await makeToken({ expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });

    await runCleanupRefreshTokens();

    const found = await prisma.refreshToken.findUnique({ where: { id: fresh.id } });
    expect(found).not.toBeNull();
  });

  it('keeps recently revoked tokens (within 30 days)', async () => {
    const recent = await makeToken({ expiresAt: daysAgo(31), revokedAt: daysAgo(5) });

    await runCleanupRefreshTokens();

    const found = await prisma.refreshToken.findUnique({ where: { id: recent.id } });
    expect(found).not.toBeNull();
  });
});
