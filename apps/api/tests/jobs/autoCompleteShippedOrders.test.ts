import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/db.js';
import { runAutoCompleteShippedOrders } from '../../src/jobs/autoCompleteShippedOrders.js';

/**
 * T7.3 acceptance:
 *   - SHIPPED orders with shippedAt > 7 days ago → COMPLETED
 *   - SHIPPED orders shippedAt < 7 days ago are left untouched
 */

const EMAIL_DOMAIN = 't73-auto-complete.test.internal';
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuv0123456789abcdefghijklmnopqrstuv';
const SKU_PREFIX = 't73-';
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

async function makeSku(code: string) {
  const sku = await prisma.sku.create({
    data: {
      productId,
      code: `${SKU_PREFIX}${code}`,
      price: '100.00',
      stock: 10,
      optionCombination: {},
    },
  });
  createdSkuIds.push(sku.id);
  return sku;
}

async function makeShippedOrder(skuId: string, shippedDaysAgo: number) {
  const shippedAt = new Date(Date.now() - shippedDaysAgo * 24 * 60 * 60 * 1000);
  const order = await prisma.order.create({
    data: {
      userId,
      status: 'SHIPPED',
      subtotal: '100.00',
      discount: '0.00',
      shippingFee: '0.00',
      total: '100.00',
      shippingAddress: SHIP_ADDR,
      paymentMethod: 'mock_card',
      paidAt: shippedAt,
      shippedAt,
      items: { create: { skuId, qty: 1, unitPrice: '100.00', skuSnapshot: { code: skuId } } },
    },
  });
  createdOrderIds.push(order.id);
  return order;
}

describe('runAutoCompleteShippedOrders', () => {
  it('completes SHIPPED orders with shippedAt older than 7 days', async () => {
    const sku = await makeSku(`old-${Date.now()}`);
    const order = await makeShippedOrder(sku.id, 8); // 8 days ago

    await runAutoCompleteShippedOrders();

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('COMPLETED');
  });

  it('leaves SHIPPED orders with shippedAt within 7 days untouched', async () => {
    const sku = await makeSku(`fresh-${Date.now()}`);
    const order = await makeShippedOrder(sku.id, 3); // 3 days ago

    await runAutoCompleteShippedOrders();

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('SHIPPED');
  });
});
