import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/db.js';

import { withTestTx } from './helpers/withTestTx.js';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('User model', () => {
  it('creates a user with defaults (CUSTOMER role, is_demo_readonly false)', async () => {
    await withTestTx(async (tx) => {
      const u = await tx.user.create({
        data: { email: 't1@vella.test', passwordHash: 'x' },
      });
      expect(u.role).toBe('CUSTOMER');
      expect(u.isDemoReadonly).toBe(false);
      expect(u.id).toMatch(/^c/); // cuid
      expect(u.createdAt).toBeInstanceOf(Date);
      expect(u.updatedAt).toBeInstanceOf(Date);
    });
  });

  it('enforces unique email (UNIQUE constraint)', async () => {
    await withTestTx(async (tx) => {
      await tx.user.create({ data: { email: 'dup@vella.test', passwordHash: 'x' } });
      await expect(
        tx.user.create({ data: { email: 'dup@vella.test', passwordHash: 'y' } }),
      ).rejects.toThrow();
    });
  });

  it('accepts ADMIN and SUPER_ADMIN role values (enum)', async () => {
    await withTestTx(async (tx) => {
      const admin = await tx.user.create({
        data: { email: 'a@vella.test', passwordHash: 'x', role: 'ADMIN' },
      });
      const sa = await tx.user.create({
        data: { email: 'sa@vella.test', passwordHash: 'x', role: 'SUPER_ADMIN' },
      });
      expect(admin.role).toBe('ADMIN');
      expect(sa.role).toBe('SUPER_ADMIN');
    });
  });
});

describe('RefreshToken model', () => {
  it('creates a token tied to a user with required fields', async () => {
    await withTestTx(async (tx) => {
      const u = await tx.user.create({ data: { email: 'r1@vella.test', passwordHash: 'x' } });
      const t = await tx.refreshToken.create({
        data: {
          userId: u.id,
          familyId: 'fam-1',
          tokenHash: 'hash-1',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      expect(t.userId).toBe(u.id);
      expect(t.familyId).toBe('fam-1');
      expect(t.revokedAt).toBeNull();
      expect(t.parentId).toBeNull();
    });
  });

  it('enforces UNIQUE(token_hash) — findUnique works, duplicate rejects', async () => {
    await withTestTx(async (tx) => {
      const u = await tx.user.create({ data: { email: 'r2@vella.test', passwordHash: 'x' } });
      await tx.refreshToken.create({
        data: {
          userId: u.id,
          familyId: 'fam-1',
          tokenHash: 'unique-hash',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });

      const found = await tx.refreshToken.findUnique({ where: { tokenHash: 'unique-hash' } });
      expect(found).not.toBeNull();

      await expect(
        tx.refreshToken.create({
          data: {
            userId: u.id,
            familyId: 'fam-2',
            tokenHash: 'unique-hash',
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        }),
      ).rejects.toThrow();
    });
  });

  it('cascades on user delete (FK ON DELETE CASCADE)', async () => {
    await withTestTx(async (tx) => {
      const u = await tx.user.create({ data: { email: 'r3@vella.test', passwordHash: 'x' } });
      await tx.refreshToken.create({
        data: {
          userId: u.id,
          familyId: 'fam-1',
          tokenHash: 'cascade-test',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });

      await tx.user.delete({ where: { id: u.id } });
      const orphan = await tx.refreshToken.findUnique({ where: { tokenHash: 'cascade-test' } });
      expect(orphan).toBeNull();
    });
  });

  it('has an index on (user_id, family_id)', async () => {
    // Verified by inspecting pg_indexes — fast lookup of rotation chains
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'refresh_tokens'
        AND indexname = 'refresh_tokens_user_id_family_id_idx'
    `;
    expect(rows).toHaveLength(1);
  });
});
