import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/db.js';
import { checkout } from '../../src/services/checkoutService.js';

/**
 * T4.3 acceptance:
 *   - Single tx: conditional stock decrement → Order + OrderItems(snapshot) →
 *     PaymentMock(PENDING) → cart deleted.
 *   - Any SKU insufficient → full tx rollback → 409 OUT_OF_STOCK.
 *   - Empty cart → 400 CART_EMPTY.
 *   - Success → Order.status = PENDING, cart gone, returns { orderId, paymentIntentId }.
 */

const EMAIL_DOMAIN = 'e2e-checkout.test';
const SKU_PREFIX = 'checkout-svc-test-';
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuv0123456789abcdefghijklmnopqrstuv';

const SHIPPING_ADDR = { name: '測試者', phone: '0912345678', city: '台北市', addr: '測試路1號' };
const PAYMENT_METHOD = 'mock_card';

let userId: string;
let productId: string;

beforeAll(async () => {
  const { seedCatalog } = await import('../../prisma/seed/products.js');
  await seedCatalog();
  const product = await prisma.product.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });
  productId = product.id;

  const user = await prisma.user.upsert({
    where: { email: `buyer@${EMAIL_DOMAIN}` },
    update: {},
    create: { email: `buyer@${EMAIL_DOMAIN}`, passwordHash: DUMMY_HASH, role: 'CUSTOMER' },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.orderStatusLog.deleteMany({ where: { order: { userId } } });
  await prisma.paymentMock.deleteMany({ where: { order: { userId } } });
  await prisma.orderItem.deleteMany({ where: { order: { userId } } });
  await prisma.order.deleteMany({ where: { userId } });
  await prisma.cart.deleteMany({ where: { userId } });
  await prisma.sku.deleteMany({ where: { code: { startsWith: SKU_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await prisma.$disconnect();
});

interface SkuSpec {
  stock: number;
  qty: number;
  price?: string;
}

/** Create SKUs + a cart with cart items for userId. Clears any existing cart first. */
async function setupCart(specs: SkuSpec[]) {
  await prisma.cart.deleteMany({ where: { userId } });
  const skus = [];
  for (let i = 0; i < specs.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    const sku = await prisma.sku.create({
      data: {
        productId,
        code: `${SKU_PREFIX}${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        price: specs[i]!.price ?? '99.00',
        stock: specs[i]!.stock,
        optionCombination: { Size: `S${i}` },
        status: 'ACTIVE',
      },
    });
    skus.push(sku);
  }
  const cart = await prisma.cart.create({ data: { userId } });
  for (let i = 0; i < specs.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    await prisma.cartItem.create({
      data: { cartId: cart.id, skuId: skus[i]!.id, qty: specs[i]!.qty },
    });
  }
  return { cart, skus };
}

// ============================================================================
// Success path
// ============================================================================

describe('checkout — success path', () => {
  it('creates PENDING order, decrements stock, clears cart, returns orderId + paymentIntentId', async () => {
    const { skus } = await setupCart([
      { stock: 10, qty: 2, price: '50.00' },
      { stock: 5, qty: 1, price: '100.00' },
    ]);

    const result = await checkout(userId, {
      shippingAddress: SHIPPING_ADDR,
      paymentMethod: PAYMENT_METHOD,
    });

    expect(result.orderId).toBeTruthy();
    expect(result.paymentIntentId).toBeTruthy();

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: result.orderId },
      include: { items: true, payments: true },
    });

    expect(order.status).toBe('PENDING');
    expect(order.paymentIntentId).toBe(result.paymentIntentId);
    // subtotal = 2×50 + 1×100 = 200
    expect(order.subtotal.toFixed(2)).toBe('200.00');
    expect(order.total.toFixed(2)).toBe('200.00');
    expect(order.items).toHaveLength(2);
    expect(order.payments).toHaveLength(1);
    expect(order.payments[0]!.status).toBe('PENDING');
    expect(order.payments[0]!.outcomeMode).toBe('AUTO_SUCCESS');

    // Cart deleted
    const cart = await prisma.cart.findFirst({ where: { userId } });
    expect(cart).toBeNull();

    // Stock decremented
    const sku0 = await prisma.sku.findUniqueOrThrow({ where: { id: skus[0]!.id } });
    const sku1 = await prisma.sku.findUniqueOrThrow({ where: { id: skus[1]!.id } });
    expect(sku0.stock).toBe(8); // 10 - 2
    expect(sku1.stock).toBe(4); // 5 - 1
  });

  it('freezes SKU price and metadata into skuSnapshot at checkout time', async () => {
    const { skus } = await setupCart([{ stock: 5, qty: 1, price: '149.00' }]);

    const result = await checkout(userId, {
      shippingAddress: SHIPPING_ADDR,
      paymentMethod: PAYMENT_METHOD,
    });

    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: result.orderId } });
    expect(item.unitPrice.toFixed(2)).toBe('149.00');

    const snap = item.skuSnapshot as {
      code: string;
      productName: string;
      optionCombination: unknown;
    };
    expect(snap.code).toBe(skus[0]!.code);
    expect(typeof snap.productName).toBe('string');
    expect(snap.optionCombination).toBeDefined();
  });

  it('passes outcomeMode AUTO_FAILURE through to PaymentMock', async () => {
    await setupCart([{ stock: 5, qty: 1 }]);

    const result = await checkout(userId, {
      shippingAddress: SHIPPING_ADDR,
      paymentMethod: PAYMENT_METHOD,
      outcomeMode: 'AUTO_FAILURE',
    });

    const payment = await prisma.paymentMock.findFirstOrThrow({
      where: { orderId: result.orderId },
    });
    expect(payment.outcomeMode).toBe('AUTO_FAILURE');
  });
});

// ============================================================================
// Error paths
// ============================================================================

describe('checkout — error paths', () => {
  it('throws CART_EMPTY when cart has no items', async () => {
    await prisma.cart.deleteMany({ where: { userId } });

    await expect(
      checkout(userId, { shippingAddress: SHIPPING_ADDR, paymentMethod: PAYMENT_METHOD }),
    ).rejects.toMatchObject({ code: 'CART_EMPTY' });
  });

  it('throws OUT_OF_STOCK and rolls back all stock when one SKU is insufficient', async () => {
    const { skus } = await setupCart([
      { stock: 10, qty: 2 }, // would succeed
      { stock: 1, qty: 5 }, // insufficient — forces rollback
    ]);

    const ordersBefore = await prisma.order.count({ where: { userId } });

    await expect(
      checkout(userId, { shippingAddress: SHIPPING_ADDR, paymentMethod: PAYMENT_METHOD }),
    ).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });

    // Both SKU stocks unchanged (full tx rollback)
    const sku0 = await prisma.sku.findUniqueOrThrow({ where: { id: skus[0]!.id } });
    const sku1 = await prisma.sku.findUniqueOrThrow({ where: { id: skus[1]!.id } });
    expect(sku0.stock).toBe(10);
    expect(sku1.stock).toBe(1);

    // No new order created (rollback)
    const ordersAfter = await prisma.order.count({ where: { userId } });
    expect(ordersAfter).toBe(ordersBefore);
  });
});
