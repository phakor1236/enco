-- CreateTable
CREATE TABLE "carts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL,
    "cart_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "carts_updated_at_idx" ON "carts"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_sku_id_key" ON "cart_items"("cart_id", "sku_id");

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- T3.1 hand-written constraints (Prisma cannot model these declaratively):
--
--   1. At least one of user_id / session_id must be set.
--   2. Partial UNIQUE on user_id    — at most one cart per logged-in user.
--   3. Partial UNIQUE on session_id — at most one cart per guest session.
--   4. cart_items.qty must be strictly positive (defense in depth — service
--      layer also validates, but a runaway client / direct SQL slip would
--      otherwise be able to wedge a row with qty = 0 or negative).
-- ---------------------------------------------------------------------------

ALTER TABLE "carts"
  ADD CONSTRAINT "carts_owner_required"
  CHECK ("user_id" IS NOT NULL OR "session_id" IS NOT NULL);

CREATE UNIQUE INDEX "carts_user_id_unique"
  ON "carts"("user_id") WHERE "user_id" IS NOT NULL;

CREATE UNIQUE INDEX "carts_session_id_unique"
  ON "carts"("session_id") WHERE "session_id" IS NOT NULL;

ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_qty_positive" CHECK ("qty" > 0);
