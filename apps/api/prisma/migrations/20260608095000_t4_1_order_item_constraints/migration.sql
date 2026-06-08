-- T4.1 follow-up: tighten OrderItem invariants caught in code review.
--
-- 1. One row per (order, SKU). Matches the CartItem (cart_id, sku_id) UNIQUE
--    from T3.1. Today checkout dedups upstream from the cart; this guarantees
--    no future retry / replay path silently doubles a line. Existing dev data
--    is empty at this point (T4.1 schema landed in the same session) so no
--    backfill / dedup is needed.
-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_id_sku_id_key" ON "order_items"("order_id", "sku_id");

-- 2. qty > 0 — mirrors the CartItem CHECK from T3.1. Prisma can't express
--    CHECK declaratively, so the constraint is added by hand and stays here
--    forever (Prisma's introspection just ignores it).
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_qty_positive" CHECK ("qty" > 0);
