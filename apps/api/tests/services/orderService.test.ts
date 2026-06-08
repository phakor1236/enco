import { OrderStatus, type Order } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/db.js';
import { transitionOrder, type TransitionActor } from '../../src/services/orderService.js';

/**
 * T4.2 acceptance:
 *   - Matrix-test every from × to combination against the SPEC §5 state
 *     machine. Illegal transitions throw 409 INVALID_STATUS_TRANSITION.
 *   - CANCELLED and REFUNDED restock the SKUs in the same tx.
 *   - PAID writes paid_at, SHIPPED writes shipped_at + ShipmentMock,
 *     REFUNDED inserts a second PaymentMock(REFUNDED).
 *   - Role gate (defense-in-depth): SHIPPED needs ADMIN+, REFUNDED needs
 *     SUPER_ADMIN; system caller (actor=null) bypasses.
 *
 * Each test owns its own user + SKU baseline so the (singleFork) suite can
 * still mutate stock without poisoning siblings.
 */

const STATUSES: OrderStatus[] = [
  'PENDING',
  'PAID',
  'SHIPPED',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
];

const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['PAID', 'CANCELLED'],
  PAID: ['SHIPPED', 'REFUNDED'],
  SHIPPED: ['COMPLETED', 'REFUNDED'],
  COMPLETED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

const TEST_EMAIL_DOMAIN = 'e2e-orderservice.test';
const TEST_SKU_PREFIX = 'orderservice-test-';
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuv0123456789abcdefghijklmnopqrstuv';

interface Fixture {
  order: Order;
  skuId: string;
  initialStock: number;
  qty: number;
}

let userId: string;
let productId: string;
let SUPER_ACTOR: TransitionActor;
let ADMIN_ACTOR: TransitionActor;
let CUSTOMER_ACTOR: TransitionActor;

beforeAll(async () => {
  const { seedCatalog } = await import('../../prisma/seed/products.js');
  await seedCatalog();
  const product = await prisma.product.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });
  productId = product.id;
  const fixtureUser = await prisma.user.upsert({
    where: { email: `fixture@${TEST_EMAIL_DOMAIN}` },
    update: {},
    create: {
      email: `fixture@${TEST_EMAIL_DOMAIN}`,
      passwordHash: DUMMY_HASH,
      role: 'CUSTOMER',
    },
  });
  userId = fixtureUser.id;

  // Real users for the operatorId FK on OrderStatusLog.
  const superUser = await prisma.user.upsert({
    where: { email: `super@${TEST_EMAIL_DOMAIN}` },
    update: {},
    create: { email: `super@${TEST_EMAIL_DOMAIN}`, passwordHash: DUMMY_HASH, role: 'SUPER_ADMIN' },
  });
  const adminUser = await prisma.user.upsert({
    where: { email: `admin@${TEST_EMAIL_DOMAIN}` },
    update: {},
    create: { email: `admin@${TEST_EMAIL_DOMAIN}`, passwordHash: DUMMY_HASH, role: 'ADMIN' },
  });
  const customerUser = await prisma.user.upsert({
    where: { email: `cust@${TEST_EMAIL_DOMAIN}` },
    update: {},
    create: { email: `cust@${TEST_EMAIL_DOMAIN}`, passwordHash: DUMMY_HASH, role: 'CUSTOMER' },
  });
  SUPER_ACTOR = { id: superUser.id, role: 'SUPER_ADMIN' };
  ADMIN_ACTOR = { id: adminUser.id, role: 'ADMIN' };
  CUSTOMER_ACTOR = { id: customerUser.id, role: 'CUSTOMER' };
});

afterAll(async () => {
  await prisma.orderStatusLog.deleteMany({ where: { order: { userId } } });
  await prisma.paymentMock.deleteMany({ where: { order: { userId } } });
  await prisma.shipmentMock.deleteMany({ where: { order: { userId } } });
  await prisma.orderItem.deleteMany({ where: { order: { userId } } });
  await prisma.order.deleteMany({ where: { userId } });
  await prisma.sku.deleteMany({ where: { code: { startsWith: TEST_SKU_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } } });
  await prisma.$disconnect();
});

/**
 * Mint a fresh Order + OrderItem + dedicated SKU pinned at a known stock.
 * Returning the SKU id and qty makes restock assertions trivial.
 */
async function makeFixture(initialStatus: OrderStatus, qty = 3): Promise<Fixture> {
  const initialStock = 10;
  const sku = await prisma.sku.create({
    data: {
      productId,
      code: `${TEST_SKU_PREFIX}${initialStatus}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      price: '10.00',
      stock: initialStock,
      optionCombination: { Size: 'M' },
      status: 'ACTIVE',
    },
  });
  const order = await prisma.order.create({
    data: {
      userId,
      status: initialStatus,
      subtotal: '30.00',
      total: '30.00',
      shippingAddress: { city: 'Test', addr: '1 fixture rd' },
      paymentMethod: 'mock_card',
      items: {
        create: { skuId: sku.id, qty, unitPrice: '10.00', skuSnapshot: { name: 'fixture' } },
      },
    },
  });
  return { order, skuId: sku.id, initialStock, qty };
}

// ============================================================================
// State machine matrix — every (from, to) combination is asserted exactly once
// ============================================================================

describe('transitionOrder — state machine matrix', () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      if (from === to) continue;
      const isAllowed = ALLOWED[from].includes(to);
      const label = `${from} → ${to}`;

      it(`${isAllowed ? 'allows' : 'rejects'} ${label}`, async () => {
        const fx = await makeFixture(from);
        const work = prisma.$transaction((tx) => transitionOrder(tx, fx.order.id, to, SUPER_ACTOR));

        if (!isAllowed) {
          await expect(work).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
          // No log row written on rejection
          const log = await prisma.orderStatusLog.findFirst({ where: { orderId: fx.order.id } });
          expect(log).toBeNull();
          return;
        }

        await work;
        const after = await prisma.order.findUniqueOrThrow({ where: { id: fx.order.id } });
        expect(after.status).toBe(to);
        const log = await prisma.orderStatusLog.findFirstOrThrow({
          where: { orderId: fx.order.id },
          orderBy: { createdAt: 'desc' },
        });
        expect(log.fromStatus).toBe(from);
        expect(log.toStatus).toBe(to);
        expect(log.operatorId).toBe(SUPER_ACTOR.id);
      });
    }
  }
});

// ============================================================================
// Side effects
// ============================================================================

describe('transitionOrder — side effects', () => {
  it('PENDING → PAID stamps paid_at and leaves stock alone', async () => {
    const fx = await makeFixture('PENDING');
    const skuBefore = await prisma.sku.findUniqueOrThrow({ where: { id: fx.skuId } });
    await prisma.$transaction((tx) =>
      transitionOrder(tx, fx.order.id, 'PAID', null, { note: 'webhook' }),
    );
    const after = await prisma.order.findUniqueOrThrow({ where: { id: fx.order.id } });
    expect(after.paidAt).not.toBeNull();
    const skuAfter = await prisma.sku.findUniqueOrThrow({ where: { id: fx.skuId } });
    expect(skuAfter.stock).toBe(skuBefore.stock);
  });

  it('PENDING → CANCELLED restocks the SKU back to its pre-checkout level', async () => {
    const fx = await makeFixture('PENDING', 4);
    await prisma.$transaction((tx) =>
      transitionOrder(tx, fx.order.id, 'CANCELLED', null, { note: 'timeout' }),
    );
    const sku = await prisma.sku.findUniqueOrThrow({ where: { id: fx.skuId } });
    expect(sku.stock).toBe(fx.initialStock + fx.qty);
  });

  it('PAID → SHIPPED stamps shipped_at and creates a ShipmentMock with the override carrier', async () => {
    const fx = await makeFixture('PAID');
    await prisma.$transaction((tx) =>
      transitionOrder(tx, fx.order.id, 'SHIPPED', SUPER_ACTOR, {
        shipment: { carrier: 'DHL', trackingNo: 'DHL-12345' },
      }),
    );
    const after = await prisma.order.findUniqueOrThrow({ where: { id: fx.order.id } });
    expect(after.shippedAt).not.toBeNull();
    const ship = await prisma.shipmentMock.findFirstOrThrow({ where: { orderId: fx.order.id } });
    expect(ship.carrier).toBe('DHL');
    expect(ship.trackingNo).toBe('DHL-12345');
    expect(ship.status).toBe('IN_TRANSIT');
  });

  it('PAID → SHIPPED auto-generates carrier + tracking when ctx is empty', async () => {
    const fx = await makeFixture('PAID');
    await prisma.$transaction((tx) => transitionOrder(tx, fx.order.id, 'SHIPPED', SUPER_ACTOR));
    const ship = await prisma.shipmentMock.findFirstOrThrow({ where: { orderId: fx.order.id } });
    expect(ship.carrier).toBe('MOCK_CARRIER');
    expect(ship.trackingNo).toMatch(/^MOCK-[0-9a-f-]{36}$/);
  });

  it('PAID → REFUNDED restocks and inserts a REFUNDED PaymentMock alongside the original', async () => {
    const fx = await makeFixture('PAID', 2);
    // Pretend the original capture left a PaymentMock(SUCCESS) row in place.
    await prisma.paymentMock.create({
      data: { orderId: fx.order.id, provider: 'mock', status: 'SUCCESS', mockResponse: {} },
    });
    await prisma.$transaction((tx) =>
      transitionOrder(tx, fx.order.id, 'REFUNDED', SUPER_ACTOR, {
        refund: { mockResponse: { reason: 'customer changed mind' } },
      }),
    );
    const sku = await prisma.sku.findUniqueOrThrow({ where: { id: fx.skuId } });
    expect(sku.stock).toBe(fx.initialStock + fx.qty);

    const payments = await prisma.paymentMock.findMany({
      where: { orderId: fx.order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(payments).toHaveLength(2);
    expect(payments[0]?.status).toBe('SUCCESS');
    expect(payments[1]?.status).toBe('REFUNDED');
    expect(payments[1]?.outcomeMode).toBe('MANUAL');
    expect(payments[1]?.mockResponse).toEqual({ reason: 'customer changed mind' });
  });

  it('SHIPPED → COMPLETED has no side effects beyond the status + log row', async () => {
    const fx = await makeFixture('SHIPPED');
    const skuBefore = await prisma.sku.findUniqueOrThrow({ where: { id: fx.skuId } });
    await prisma.$transaction((tx) => transitionOrder(tx, fx.order.id, 'COMPLETED', null));
    const after = await prisma.order.findUniqueOrThrow({
      where: { id: fx.order.id },
      include: { shipments: true, payments: true },
    });
    expect(after.status).toBe('COMPLETED');
    expect(after.payments).toHaveLength(0);
    expect(after.shipments).toHaveLength(0);
    const skuAfter = await prisma.sku.findUniqueOrThrow({ where: { id: fx.skuId } });
    expect(skuAfter.stock).toBe(skuBefore.stock);
  });
});

// ============================================================================
// Role gate (defense-in-depth — routes also requireRole upstream)
// ============================================================================

describe('transitionOrder — actor role gate', () => {
  it('rejects CUSTOMER trying to ship', async () => {
    const fx = await makeFixture('PAID');
    await expect(
      prisma.$transaction((tx) => transitionOrder(tx, fx.order.id, 'SHIPPED', CUSTOMER_ACTOR)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows ADMIN to ship', async () => {
    const fx = await makeFixture('PAID');
    await prisma.$transaction((tx) => transitionOrder(tx, fx.order.id, 'SHIPPED', ADMIN_ACTOR));
    const after = await prisma.order.findUniqueOrThrow({ where: { id: fx.order.id } });
    expect(after.status).toBe('SHIPPED');
  });

  it('rejects ADMIN trying to refund (only SUPER_ADMIN may)', async () => {
    const fx = await makeFixture('PAID');
    await expect(
      prisma.$transaction((tx) => transitionOrder(tx, fx.order.id, 'REFUNDED', ADMIN_ACTOR)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows actor=null (system / webhook / cron) to drive any transition', async () => {
    const fx = await makeFixture('PAID');
    await prisma.$transaction((tx) => transitionOrder(tx, fx.order.id, 'REFUNDED', null));
    const after = await prisma.order.findUniqueOrThrow({ where: { id: fx.order.id } });
    expect(after.status).toBe('REFUNDED');
  });
});

// ============================================================================
// Lookup failure
// ============================================================================

describe('transitionOrder — lookup failures', () => {
  it('returns 404 ORDER_NOT_FOUND for an unknown order id', async () => {
    await expect(
      prisma.$transaction((tx) => transitionOrder(tx, 'order-does-not-exist', 'PAID', null)),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
  });
});
