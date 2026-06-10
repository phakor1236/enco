// eslint-disable-next-line import/default
import bcrypt from 'bcryptjs';

import { withAdvisoryLock } from '../lib/advisoryLock.js';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';

import { JOB_KEYS } from './keys.js';

const DEMO_PASSWORD = 'demo1234';
const ADMIN_PASSWORD = 'admin1234';
const BCRYPT_ROUNDS = 12;

async function clearUserData(): Promise<void> {
  // AdminActionLog references users with onDelete: Restrict — clear before orders.
  await prisma.adminActionLog.deleteMany({});
  // Order cascade-deletes: CouponUsage, OrderItem, OrderStatusLog, PaymentMock, ShipmentMock.
  await prisma.order.deleteMany({});
  // Cart cascade-deletes CartItem.
  await prisma.cart.deleteMany({});
  await prisma.refreshToken.deleteMany({});
}

async function reseedDemoAccounts(): Promise<void> {
  const [demoHash, adminHash] = await Promise.all([
    bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS),
    bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS),
  ]);

  await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: { passwordHash: demoHash, role: 'CUSTOMER', isDemoReadonly: true },
    create: {
      email: 'demo@example.com',
      passwordHash: demoHash,
      role: 'CUSTOMER',
      isDemoReadonly: true,
    },
  });
  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: { passwordHash: adminHash, role: 'ADMIN', isDemoReadonly: true },
    create: {
      email: 'admin@example.com',
      passwordHash: adminHash,
      role: 'ADMIN',
      isDemoReadonly: true,
    },
  });
  await prisma.user.upsert({
    where: { email: 'superadmin@example.com' },
    update: { passwordHash: adminHash, role: 'SUPER_ADMIN', isDemoReadonly: false },
    create: {
      email: 'superadmin@example.com',
      passwordHash: adminHash,
      role: 'SUPER_ADMIN',
      isDemoReadonly: false,
    },
  });
}

export async function runResetDemoDb(): Promise<void> {
  await withAdvisoryLock(JOB_KEYS.RESET_DEMO_DB, async () => {
    logger.info('Demo DB reset starting');

    const { seedCatalog } = await import('../../prisma/seed/products.js');

    await clearUserData();
    await reseedDemoAccounts();
    const catalog = await seedCatalog();

    logger.info(
      { categories: catalog.categories, products: catalog.products, skus: catalog.skus },
      'Demo DB reset complete',
    );
  });
}
