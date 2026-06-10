import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrderStatus } from '@prisma/client';

import { prisma } from '../../src/lib/db.js';
import { runCancelTimedOutOrders } from '../../src/jobs/cancelTimedOutOrders.js';

/**
 * T7.2 acceptance:
 *   - PENDING orders older than 30 min → CANCELLED + stock restored
 *   - Fresh PENDING orders (< 30 min) are left untouched
 *   - Already-terminal orders (CANCELLED, PAID) are not touched
 */

const EMAIL_DOMAIN = 't72-cancel-timeout.test.internal';
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuv0123456789abcdefghijklmnopqrstuv';
const SKU_PREFIX = 't72-';
const SHIP_ADDR = { name: 'Test', phone: '0912345678', city: 'Taipei', addr: 'Test Rd 1' };

let userId: string;
let productId: string;

const createdOrderIds: string[] = [];
const createdSkuIds: string[] = [];

beforeAll(async () => {
  const { seedCatalog } = await import('../../prisma/seed/products.js');
  await seedCatalog();

  const user = await prisma.user.upsert({
    where: { email: `user@${EMAIL_DOMAIN}` },
    update: {},
    create: { email: `user@${EMAIL_DOMAIN}`, passwordHash: DUMMY_HASH },
  });
  userId = user.id;

  const product = await prisma.product.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });
  productId = product.id;
});

afterAll(async () => {
  await prisma.orderStatusLog.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  await prisma.sku.deleteMany({ where: { id: { in: createdSkuIds } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await prisma.$disconnect();
});

async function makeSku(code: string, stock: number) {
  const sku = await prisma.sku.create({
    data: {
      productId,
      code: `${SKU_PREFIX}${code}`,
      price: '100.00',
      stock,
      optionCombination: {},
    },
  });
  createdSkuIds.push(sku.id);
  return sku;
}

async function makeOrder(skuId: string, qty: number, status: OrderStatus, ageMs: number) {
  const order = await prisma.order.create({
    data: {
      userId,
      status,
      subtotal: '100.00',
      discount: '0.00',
      shippingFee: '0.00',
      total: '100.00',
      shippingAddress: SHIP_ADDR,
      paymentMethod: 'mock_card',
      createdAt: new Date(Date.now() - ageMs),
      items: { create: { skuId, qty, unitPrice: '100.00', skuSnapshot: { code: skuId } } },
    },
  });
  createdOrderIds.push(order.id);
  return order;
}

describe('runCancelTimedOutOrders', () => {
  it('cancels PENDING orders older than 30 min and restores stock', async () => {
    const sku = await makeSku(`stale-${Date.now()}`, 10);
    const order = await makeOrder(sku.id, 2, 'PENDING', 31 * 60 * 1000); // 31 min old

    await runCancelTimedOutOrders();

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('CANCELLED');

    const updatedSku = await prisma.sku.findUniqueOrThrow({ where: { id: sku.id } });
    expect(updatedSku.stock).toBe(12); // 10 + 2 restocked
  });

  it('does not cancel fresh PENDING orders (< 30 min)', async () => {
    const sku = await makeSku(`fresh-${Date.now()}`, 10);
    const order = await makeOrder(sku.id, 1, 'PENDING', 5 * 60 * 1000); // 5 min old

    await runCancelTimedOutOrders();

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('PENDING');
  });

  it('skips already-cancelled orders without error', async () => {
    const sku = await makeSku(`already-cancelled-${Date.now()}`, 10);
    const order = await makeOrder(sku.id, 1, 'CANCELLED', 60 * 60 * 1000); // 1h old but already CANCELLED

    await expect(runCancelTimedOutOrders()).resolves.toBeUndefined();

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('CANCELLED'); // unchanged
  });
});
