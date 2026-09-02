import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { ErrorCodes, type CartDto, type CartItemDto, type CartMergeResult } from '@app/shared';

import { AppError } from '../lib/errors.js';
import { type DbClient } from '../lib/db.js';

/**
 * Cart service — supports the two ownership shapes per SPEC §5:
 *   { userId: string,    sessionId: null }     for logged-in users
 *   { userId: null,      sessionId: string }   for guests
 * Routes resolve which shape applies before calling in. Service never
 * peeks at JWTs or cookies.
 */

export type CartOwner = { userId: string; sessionId?: null } | { sessionId: string; userId?: null };

export function newGuestSessionId(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Get-or-create + read
// ---------------------------------------------------------------------------

/**
 * Idempotent fetch — returns the existing cart for the owner, or creates an
 * empty one. The partial UNIQUE indexes from T3.1 enforce "one cart per
 * owner" at the DB layer; we still race-guard via the catch-and-refetch
 * pattern for the rare double-create from concurrent first writes.
 */
export async function getOrCreateCart(db: DbClient, owner: CartOwner): Promise<{ id: string }> {
  const where: Prisma.CartWhereInput = ownerWhere(owner);
  const existing = await db.cart.findFirst({ where, select: { id: true } });
  if (existing) return existing;

  try {
    return await db.cart.create({
      data: {
        userId: owner.userId ?? null,
        sessionId: owner.sessionId ?? null,
      },
      select: { id: true },
    });
  } catch (e) {
    // Concurrent create — another request won the partial-unique race.
    // Refetch and return what's there.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const winner = await db.cart.findFirstOrThrow({ where, select: { id: true } });
      return winner;
    }
    throw e;
  }
}

export async function getCart(db: DbClient, owner: CartOwner): Promise<CartDto> {
  const cart = await getOrCreateCart(db, owner);
  return loadCartDto(db, cart.id);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

interface AddInput {
  skuId: string;
  qty: number;
}

export async function addItem(db: DbClient, owner: CartOwner, input: AddInput): Promise<CartDto> {
  const sku = await loadActiveSku(db, input.skuId);
  const cart = await getOrCreateCart(db, owner);

  // Atomic increment-or-create with stock post-check. Two parallel add-N calls
  // both bump qty via `increment` (no read-then-write race that loses one add);
  // exceeding stock throws inside the tx so the increment rolls back.
  //
  // INVARIANT: this upsert must stay eligible for Prisma's native
  // `INSERT ... ON CONFLICT DO UPDATE`. Attaching a nested read (an `include`)
  // disqualifies it, and Prisma silently falls back to SELECT-then-write —
  // which is NOT atomic: two concurrent adds both miss the row, both INSERT,
  // and the loser dies on the (cart_id, sku_id) unique index with P2002,
  // dropping one add entirely. That is why stock is re-read separately below
  // instead of being pulled in via `include`.
  const work = async (tx: DbClient): Promise<void> => {
    const after = await tx.cartItem.upsert({
      where: { cartId_skuId: { cartId: cart.id, skuId: sku.id } },
      update: { qty: { increment: input.qty } },
      create: { cartId: cart.id, skuId: sku.id, qty: input.qty },
    });
    // Read inside the tx rather than trusting the pre-tx `loadActiveSku`
    // snapshot: stock may have moved between that read and this write.
    const { stock } = await tx.sku.findUniqueOrThrow({
      where: { id: sku.id },
      select: { stock: true },
    });
    if (after.qty > stock) {
      throw new AppError(ErrorCodes.OUT_OF_STOCK, `庫存不足:此 SKU 目前僅剩 ${stock} 件`, 409, {
        available: stock,
        requested: after.qty,
      });
    }
  };

  if ('$transaction' in db) {
    await db.$transaction(work);
  } else {
    await work(db);
  }

  return loadCartDto(db, cart.id);
}

export async function updateItem(
  db: DbClient,
  owner: CartOwner,
  itemId: string,
  qty: number,
): Promise<CartDto> {
  const cart = await getOrCreateCart(db, owner);
  const item = await db.cartItem.findUnique({
    where: { id: itemId },
    include: { sku: { select: { stock: true, status: true } } },
  });
  if (!item || item.cartId !== cart.id) {
    throw new AppError(ErrorCodes.CART_ITEM_NOT_FOUND, '購物車項目不存在', 404);
  }
  if (item.sku.status !== 'ACTIVE') {
    throw new AppError(ErrorCodes.SKU_INACTIVE, '此商品已下架', 409);
  }
  if (qty > item.sku.stock) {
    throw new AppError(
      ErrorCodes.OUT_OF_STOCK,
      `庫存不足:此 SKU 目前僅剩 ${item.sku.stock} 件`,
      409,
      { available: item.sku.stock, requested: qty },
    );
  }

  await db.cartItem.update({ where: { id: itemId }, data: { qty } });
  return loadCartDto(db, cart.id);
}

export async function removeItem(db: DbClient, owner: CartOwner, itemId: string): Promise<CartDto> {
  const cart = await getOrCreateCart(db, owner);
  const item = await db.cartItem.findUnique({ where: { id: itemId }, select: { cartId: true } });
  if (!item || item.cartId !== cart.id) {
    throw new AppError(ErrorCodes.CART_ITEM_NOT_FOUND, '購物車項目不存在', 404);
  }
  await db.cartItem.delete({ where: { id: itemId } });
  return loadCartDto(db, cart.id);
}

// ---------------------------------------------------------------------------
// Merge guest cart into member cart (T3.3)
// ---------------------------------------------------------------------------

/**
 * Merge the guest cart identified by `sessionId` into the user's cart, then
 * delete the guest cart row (cart_items cascade via FK).
 *
 *   - same SKU on both sides → qty sums
 *   - sum exceeds SKU stock  → clamp to stock, report in `truncatedItems`
 *   - ARCHIVED SKU           → silently drop, report in `droppedItems`
 *   - sessionId missing / guest cart missing / guest cart empty → no-op
 *
 * MUST be called inside an outer `prisma.$transaction` (caller wraps + decides
 * whether to catch). Login / register MUST catch — per SPEC §5 a merge
 * failure surfaces a fallback toast but never blocks auth.
 */
export async function mergeGuestCart(
  tx: DbClient,
  userId: string,
  sessionId: string | null | undefined,
): Promise<CartMergeResult> {
  const result: CartMergeResult = { truncatedItems: [], droppedItems: [] };
  if (!sessionId) return result;

  // Filter `userId: null` so a stale cookie pointing at a previously-merged
  // cart (which would now have userId set, were that possible) doesn't get
  // re-merged. In practice the partial unique indexes already preclude this,
  // but the predicate makes the intent explicit.
  const guest = await tx.cart.findFirst({
    where: { sessionId, userId: null },
    select: {
      id: true,
      items: {
        select: {
          skuId: true,
          qty: true,
          sku: { select: { stock: true, status: true } },
        },
      },
    },
  });
  if (!guest) return result;

  if (guest.items.length > 0) {
    const memberCart = await getOrCreateCart(tx, { userId });
    const existing = await tx.cartItem.findMany({
      where: {
        cartId: memberCart.id,
        skuId: { in: guest.items.map((i) => i.skuId) },
      },
      select: { skuId: true, qty: true },
    });
    const memberQtyBySku = new Map(existing.map((e) => [e.skuId, e.qty]));

    for (const g of guest.items) {
      if (g.sku.status !== 'ACTIVE') {
        result.droppedItems.push({ skuId: g.skuId, reason: 'INACTIVE' });
        continue;
      }
      if (g.sku.stock <= 0) {
        result.droppedItems.push({ skuId: g.skuId, reason: 'OUT_OF_STOCK' });
        continue;
      }
      const requested = (memberQtyBySku.get(g.skuId) ?? 0) + g.qty;
      const granted = Math.min(requested, g.sku.stock);
      if (granted < requested) {
        result.truncatedItems.push({ skuId: g.skuId, requested, granted });
      }
      // Sequential awaits inside the tx — parallel writes on a single tx
      // connection can deadlock and lose ordering. Guest carts are small
      // (~items per user) so the perf cost is negligible.
      // eslint-disable-next-line no-await-in-loop
      await tx.cartItem.upsert({
        where: { cartId_skuId: { cartId: memberCart.id, skuId: g.skuId } },
        update: { qty: granted },
        create: { cartId: memberCart.id, skuId: g.skuId, qty: granted },
      });
    }
  }

  // FK cart_items.cart_id ON DELETE CASCADE (schema T3.1) drops the guest items.
  await tx.cart.delete({ where: { id: guest.id } });
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ownerWhere(owner: CartOwner): Prisma.CartWhereInput {
  if (owner.userId) return { userId: owner.userId };
  return { sessionId: owner.sessionId };
}

async function loadActiveSku(
  db: DbClient,
  skuId: string,
): Promise<{
  id: string;
  stock: number;
  status: 'ACTIVE' | 'ARCHIVED';
}> {
  const sku = await db.sku.findUnique({
    where: { id: skuId },
    select: { id: true, stock: true, status: true },
  });
  if (!sku) throw new AppError(ErrorCodes.SKU_NOT_FOUND, '找不到此商品規格', 404);
  if (sku.status !== 'ACTIVE') {
    throw new AppError(ErrorCodes.SKU_INACTIVE, '此商品已下架', 409);
  }
  return sku;
}

async function loadCartDto(db: DbClient, cartId: string): Promise<CartDto> {
  const rows = await db.cartItem.findMany({
    where: { cartId },
    orderBy: { createdAt: 'asc' },
    include: {
      sku: {
        include: {
          product: {
            select: {
              id: true,
              slug: true,
              name: true,
              images: { orderBy: { sort: 'asc' }, take: 1 },
            },
          },
        },
      },
    },
  });

  const items: CartItemDto[] = rows.map((r) => {
    const unit = r.sku.price;
    const line = unit.mul(r.qty);
    return {
      id: r.id,
      skuId: r.skuId,
      qty: r.qty,
      unitPrice: unit.toFixed(2),
      lineTotal: line.toFixed(2),
      product: {
        id: r.sku.product.id,
        slug: r.sku.product.slug,
        name: r.sku.product.name,
        primaryImage: r.sku.product.images[0]
          ? { url: r.sku.product.images[0].url, alt: r.sku.product.images[0].alt }
          : null,
      },
      skuCode: r.sku.code,
      optionCombination: r.sku.optionCombination as Record<string, string>,
      stock: r.sku.stock,
    };
  });

  const subtotal = rows
    .reduce((acc, r) => acc.add(r.sku.price.mul(r.qty)), new Prisma.Decimal(0))
    .toFixed(2);

  return {
    id: cartId,
    items,
    itemCount: items.reduce((n, it) => n + it.qty, 0),
    subtotal,
  };
}
