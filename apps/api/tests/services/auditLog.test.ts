import { type Prisma } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/db.js';
import { withAuditLog } from '../../src/services/auditLog.js';

/**
 * T6.2 acceptance:
 *   - core logic success → business change + AdminActionLog committed in same tx.
 *   - core logic throw → full rollback; AdminActionLog not written.
 *   - diff deny-list: password_hash / passwordHash / token_hash / tokenHash /
 *     refresh_token / refreshToken / ip / user_agent / userAgent stripped.
 */

// Seed a real admin user so actorId FK is valid.
const ACTOR_EMAIL = 'audit-test-actor@internal.test';
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuv0123456789abcdefghijklmnopqrstuv';

let actorId: string;

// All logs created by these tests share a known resource prefix so afterAll can clean up.
const RESOURCE_TYPE = 'test_resource';
const RESOURCE_ID_PREFIX = 'audit-test-';

afterAll(async () => {
  await prisma.adminActionLog.deleteMany({
    where: { resourceType: RESOURCE_TYPE, resourceId: { startsWith: RESOURCE_ID_PREFIX } },
  });
  await prisma.user.deleteMany({ where: { email: ACTOR_EMAIL } });
  await prisma.$disconnect();
});

async function getActor(): Promise<string> {
  if (actorId) return actorId;
  const user = await prisma.user.upsert({
    where: { email: ACTOR_EMAIL },
    update: {},
    create: { email: ACTOR_EMAIL, passwordHash: DUMMY_HASH, role: 'ADMIN' },
  });
  actorId = user.id;
  return actorId;
}

describe('withAuditLog', () => {
  it('commits core logic result + AdminActionLog in the same tx on success', async () => {
    const actor = await getActor();
    const resourceId = `${RESOURCE_ID_PREFIX}success-${Date.now()}`;

    const result = await withAuditLog(
      { actorId: actor, resourceType: RESOURCE_TYPE, resourceId, action: 'create' },
      async () => ({ ok: true }),
    );

    expect(result).toEqual({ ok: true });

    const log = await prisma.adminActionLog.findFirst({
      where: { actorId: actor, resourceType: RESOURCE_TYPE, resourceId, action: 'create' },
    });
    expect(log).not.toBeNull();
    expect(log?.actorId).toBe(actor);
  });

  it('rolls back the entire tx when core logic throws — no AdminActionLog written', async () => {
    const actor = await getActor();
    const resourceId = `${RESOURCE_ID_PREFIX}rollback-${Date.now()}`;

    await expect(
      withAuditLog(
        { actorId: actor, resourceType: RESOURCE_TYPE, resourceId, action: 'update' },
        async () => {
          throw new Error('business logic failed');
        },
      ),
    ).rejects.toThrow('business logic failed');

    const log = await prisma.adminActionLog.findFirst({
      where: { actorId: actor, resourceType: RESOURCE_TYPE, resourceId },
    });
    expect(log).toBeNull();
  });

  it('strips deny-list fields from diff before writing', async () => {
    const actor = await getActor();
    const resourceId = `${RESOURCE_ID_PREFIX}denylist-${Date.now()}`;

    const dirtyDiff: Prisma.InputJsonObject = {
      name: 'VELLA Tee',
      password_hash: 'secret',
      passwordHash: 'secret',
      token_hash: 'tok',
      tokenHash: 'tok',
      refresh_token: 'rt',
      refreshToken: 'rt',
      ip: '1.2.3.4',
      user_agent: 'Mozilla',
      userAgent: 'Mozilla',
      price: '99.00',
    };

    await withAuditLog(
      {
        actorId: actor,
        resourceType: RESOURCE_TYPE,
        resourceId,
        action: 'update',
        diff: dirtyDiff,
      },
      async () => null,
    );

    const log = await prisma.adminActionLog.findFirstOrThrow({
      where: { actorId: actor, resourceType: RESOURCE_TYPE, resourceId },
    });

    const diff = log.diff as Record<string, unknown>;
    // Allowed fields preserved
    expect(diff['name']).toBe('VELLA Tee');
    expect(diff['price']).toBe('99.00');
    // Deny-list fields stripped
    for (const key of [
      'password_hash',
      'passwordHash',
      'token_hash',
      'tokenHash',
      'refresh_token',
      'refreshToken',
      'ip',
      'user_agent',
      'userAgent',
    ]) {
      expect(diff).not.toHaveProperty(key);
    }
  });

  it('recursively strips deny-list keys from nested before/after objects', async () => {
    const actor = await getActor();
    const resourceId = `${RESOURCE_ID_PREFIX}nested-${Date.now()}`;

    const nestedDiff: Prisma.InputJsonObject = {
      before: { password_hash: 'old', name: 'Old Tee' },
      after: { password_hash: 'new', name: 'New Tee', price: '120.00' },
    };

    await withAuditLog(
      {
        actorId: actor,
        resourceType: RESOURCE_TYPE,
        resourceId,
        action: 'update',
        diff: nestedDiff,
      },
      async () => null,
    );

    const log = await prisma.adminActionLog.findFirstOrThrow({
      where: { actorId: actor, resourceType: RESOURCE_TYPE, resourceId },
    });
    const diff = log.diff as Record<string, Record<string, unknown>>;
    expect(diff['before']).not.toHaveProperty('password_hash');
    expect(diff['before']?.['name']).toBe('Old Tee');
    expect(diff['after']).not.toHaveProperty('password_hash');
    expect(diff['after']?.['name']).toBe('New Tee');
    expect(diff['after']?.['price']).toBe('120.00');
  });

  it('writes null diff when all top-level keys are deny-listed', async () => {
    const actor = await getActor();
    const resourceId = `${RESOURCE_ID_PREFIX}alldenied-${Date.now()}`;

    await withAuditLog(
      {
        actorId: actor,
        resourceType: RESOURCE_TYPE,
        resourceId,
        action: 'update',
        diff: { ip: '1.2.3.4', password_hash: 'x' },
      },
      async () => null,
    );

    const log = await prisma.adminActionLog.findFirstOrThrow({
      where: { actorId: actor, resourceType: RESOURCE_TYPE, resourceId },
    });
    expect(log.diff).toBeNull();
  });

  it('rolls back business operation when AdminActionLog write fails (invalid actorId FK)', async () => {
    await expect(
      withAuditLog(
        {
          actorId: 'nonexistent-user-id',
          resourceType: RESOURCE_TYPE,
          resourceId: `${RESOURCE_ID_PREFIX}fk-fail-${Date.now()}`,
          action: 'create',
        },
        async () => ({ written: true }),
      ),
    ).rejects.toThrow(); // FK violation → entire tx rolls back
  });
});
