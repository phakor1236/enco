-- AlterTable
ALTER TABLE "product_images" ADD COLUMN     "alt" TEXT;

-- AlterTable
ALTER TABLE "variant_options" ADD COLUMN     "sort" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "variant_options_variant_id_sort_idx" ON "variant_options"("variant_id", "sort");
