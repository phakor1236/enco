import { Prisma, ProductStatus } from '@prisma/client';

import { prisma } from '../../src/lib/db.js';

/**
 * T2.2 catalog seed.
 *
 * Shape: 5 categories × 6 products. Each product has a single variant axis
 * (Color or Size) with 2-4 options → 2-4 SKUs (avg ~3, matching plan T2.2).
 * Images are placeholder URLs from picsum.photos seeded by slug so the same
 * product always renders the same image.
 *
 * Idempotency: every entity upserts by a stable unique key (slug for
 * Category/Product, code for Sku, composite for Variant/VariantOption).
 * Safe to run on a populated DB; values overwrite.
 */

type VariantSpec = {
  name: 'Color' | 'Size' | 'Material';
  options: string[];
};

type ProductSpec = {
  name: string;
  slug: string;
  description: string;
  basePrice: number;
  variant: VariantSpec;
  /** Price delta per option index (e.g. larger size +$5). */
  priceDeltas?: number[];
  /** Stock per SKU. Defaults to a fixed number per category. */
  stock?: number;
};

type CategorySpec = {
  name: string;
  slug: string;
  products: ProductSpec[];
};

const CATEGORIES: CategorySpec[] = [
  {
    name: 'Apparel',
    slug: 'apparel',
    products: [
      {
        name: 'Classic Crew Tee',
        slug: 'classic-crew-tee',
        description: 'Mid-weight cotton crew tee with a tailored fit.',
        basePrice: 29,
        variant: { name: 'Size', options: ['XS', 'S', 'M', 'L'] },
      },
      {
        name: 'Stretch Oxford Shirt',
        slug: 'stretch-oxford-shirt',
        description: 'Wrinkle-resistant oxford with 2% spandex for movement.',
        basePrice: 68,
        variant: { name: 'Size', options: ['S', 'M', 'L'] },
        priceDeltas: [0, 0, 4],
      },
      {
        name: 'Pleated Wool Trouser',
        slug: 'pleated-wool-trouser',
        description: 'Italian wool trousers with a forward-pleat front.',
        basePrice: 145,
        variant: { name: 'Size', options: ['30', '32', '34', '36'] },
      },
      {
        name: 'Quilted Field Jacket',
        slug: 'quilted-field-jacket',
        description: 'Diamond-quilted shell, corduroy collar, four hand pockets.',
        basePrice: 198,
        variant: { name: 'Color', options: ['Olive', 'Navy', 'Black'] },
      },
      {
        name: 'Merino Half-Zip',
        slug: 'merino-half-zip',
        description: '18.5-micron merino mid-layer, machine washable.',
        basePrice: 118,
        variant: { name: 'Color', options: ['Charcoal', 'Heather Grey'] },
      },
      {
        name: 'Linen Camp Shirt',
        slug: 'linen-camp-shirt',
        description: 'Belgian linen with a camp collar and chest patch pocket.',
        basePrice: 88,
        variant: { name: 'Size', options: ['S', 'M', 'L', 'XL'] },
      },
    ],
  },
  {
    name: 'Footwear',
    slug: 'footwear',
    products: [
      {
        name: 'Suede Court Sneaker',
        slug: 'suede-court-sneaker',
        description: 'Low-profile court silhouette in soft Italian suede.',
        basePrice: 135,
        variant: { name: 'Size', options: ['8', '9', '10', '11'] },
      },
      {
        name: 'Penny Loafer',
        slug: 'penny-loafer',
        description: 'Hand-stitched moc-toe penny loafer on a leather sole.',
        basePrice: 220,
        variant: { name: 'Color', options: ['Black', 'Cognac'] },
      },
      {
        name: 'Chukka Boot',
        slug: 'chukka-boot',
        description: 'Two-eyelet chukka in pull-up leather with crepe sole.',
        basePrice: 178,
        variant: { name: 'Size', options: ['9', '10', '11'] },
      },
      {
        name: 'Canvas Slip-On',
        slug: 'canvas-slip-on',
        description: 'Vulcanized rubber sole, washed canvas upper.',
        basePrice: 48,
        variant: { name: 'Color', options: ['White', 'Black', 'Navy'] },
      },
      {
        name: 'Trail Runner',
        slug: 'trail-runner',
        description: 'Lugged Vibram outsole, ripstop upper, no-sew overlays.',
        basePrice: 152,
        variant: { name: 'Size', options: ['9', '10', '11', '12'] },
      },
      {
        name: 'Leather Derby',
        slug: 'leather-derby',
        description: 'Goodyear-welted derby in box calf leather.',
        basePrice: 245,
        variant: { name: 'Color', options: ['Black', 'Brown'] },
      },
    ],
  },
  {
    name: 'Accessories',
    slug: 'accessories',
    products: [
      {
        name: 'Leather Bifold Wallet',
        slug: 'leather-bifold-wallet',
        description: 'Vegetable-tanned leather bifold, six card slots.',
        basePrice: 62,
        variant: { name: 'Color', options: ['Black', 'Tan'] },
      },
      {
        name: 'Woven Belt',
        slug: 'woven-belt',
        description: 'Elasticated weave with a brushed nickel buckle.',
        basePrice: 45,
        variant: { name: 'Size', options: ['S', 'M', 'L'] },
      },
      {
        name: 'Wool Beanie',
        slug: 'wool-beanie',
        description: 'Ribbed lambswool beanie with cuffed brim.',
        basePrice: 32,
        variant: { name: 'Color', options: ['Black', 'Oat', 'Forest'] },
      },
      {
        name: 'Selvedge Tote',
        slug: 'selvedge-tote',
        description: 'Japanese selvedge canvas tote with leather handles.',
        basePrice: 95,
        variant: { name: 'Color', options: ['Natural', 'Indigo'] },
      },
      {
        name: 'Linen Pocket Square',
        slug: 'linen-pocket-square',
        description: 'Hand-rolled Belgian linen pocket square, 32cm.',
        basePrice: 28,
        variant: { name: 'Color', options: ['White', 'Slate', 'Burgundy'] },
      },
      {
        name: 'Knit Tie',
        slug: 'knit-tie',
        description: 'Italian silk knit tie, flat-bottom finish.',
        basePrice: 58,
        variant: { name: 'Color', options: ['Navy', 'Charcoal', 'Burgundy'] },
      },
    ],
  },
  {
    name: 'Home & Living',
    slug: 'home-living',
    products: [
      {
        name: 'Linen Throw',
        slug: 'linen-throw',
        description: 'Stonewashed linen throw, fringed edges, 130×170cm.',
        basePrice: 128,
        variant: { name: 'Color', options: ['Stone', 'Indigo', 'Olive'] },
      },
      {
        name: 'Ceramic Mug',
        slug: 'ceramic-mug',
        description: 'Hand-thrown stoneware mug with a reactive glaze.',
        basePrice: 24,
        variant: { name: 'Color', options: ['Cream', 'Slate', 'Ochre'] },
      },
      {
        name: 'Soy Wax Candle',
        slug: 'soy-wax-candle',
        description: '60-hour burn, hand-poured in a reusable glass vessel.',
        basePrice: 38,
        variant: {
          name: 'Material',
          options: ['Cedarwood', 'Fig & Vetiver', 'Sea Salt'],
        },
      },
      {
        name: 'Brass Desk Lamp',
        slug: 'brass-desk-lamp',
        description: 'Articulated brass arm with a porcelain socket.',
        basePrice: 215,
        variant: { name: 'Color', options: ['Brass', 'Antique Black'] },
      },
      {
        name: 'Cotton Bath Towel',
        slug: 'cotton-bath-towel',
        description: 'Turkish long-staple cotton, 600 GSM, 70×140cm.',
        basePrice: 42,
        variant: { name: 'Color', options: ['White', 'Charcoal', 'Sand'] },
      },
      {
        name: 'Walnut Cutting Board',
        slug: 'walnut-cutting-board',
        description: 'Edge-grain American walnut, juice groove on one side.',
        basePrice: 88,
        variant: { name: 'Size', options: ['Small', 'Medium', 'Large'] },
        priceDeltas: [0, 12, 28],
      },
    ],
  },
  {
    name: 'Electronics',
    slug: 'electronics',
    products: [
      {
        name: 'Compact Bluetooth Speaker',
        slug: 'compact-bluetooth-speaker',
        description: '12-hour battery, IPX5 splash resistant, USB-C charging.',
        basePrice: 89,
        variant: { name: 'Color', options: ['Graphite', 'Sand'] },
      },
      {
        name: 'Wireless Charging Pad',
        slug: 'wireless-charging-pad',
        description: 'Qi 15W charger with woven fabric finish.',
        basePrice: 39,
        variant: { name: 'Color', options: ['Black', 'Grey'] },
      },
      {
        name: 'USB-C Hub',
        slug: 'usb-c-hub',
        description: '7-in-1 hub: HDMI, two USB-A, SD, microSD, 100W PD.',
        basePrice: 65,
        variant: { name: 'Color', options: ['Space Grey', 'Silver'] },
      },
      {
        name: 'Mechanical Keyboard',
        slug: 'mechanical-keyboard',
        description: '75% layout, hot-swappable, doubleshot PBT keycaps.',
        basePrice: 175,
        variant: {
          name: 'Material',
          options: ['Linear', 'Tactile', 'Clicky'],
        },
      },
      {
        name: 'Over-Ear Headphones',
        slug: 'over-ear-headphones',
        description: '40mm drivers, 40-hour battery, active noise cancelling.',
        basePrice: 248,
        variant: { name: 'Color', options: ['Black', 'Beige'] },
      },
      {
        name: 'E-Reader Sleeve',
        slug: 'e-reader-sleeve',
        description: 'Felt and leather sleeve sized for 7-inch e-readers.',
        basePrice: 34,
        variant: { name: 'Color', options: ['Grey', 'Tan'] },
      },
    ],
  },
];

const DEFAULT_STOCK = 25;

function picsumUrl(slug: string, n: number): string {
  return `https://picsum.photos/seed/${slug}-${n}/800/800`;
}

async function upsertCategory(spec: CategorySpec): Promise<string> {
  const c = await prisma.category.upsert({
    where: { slug: spec.slug },
    update: { name: spec.name },
    create: { name: spec.name, slug: spec.slug },
    select: { id: true },
  });
  return c.id;
}

async function upsertProduct(categoryId: string, spec: ProductSpec): Promise<string> {
  const product = await prisma.product.upsert({
    where: { slug: spec.slug },
    update: {
      name: spec.name,
      description: spec.description,
      basePrice: new Prisma.Decimal(spec.basePrice),
      categoryId,
      status: ProductStatus.ACTIVE,
    },
    create: {
      name: spec.name,
      slug: spec.slug,
      description: spec.description,
      basePrice: new Prisma.Decimal(spec.basePrice),
      categoryId,
      status: ProductStatus.ACTIVE,
    },
    select: { id: true },
  });
  return product.id;
}

async function upsertImages(productId: string, slug: string): Promise<void> {
  // 3 placeholder images per product so the gallery has something to scroll.
  const existing = await prisma.productImage.findMany({
    where: { productId },
    select: { id: true },
  });
  if (existing.length >= 3) return; // already seeded — don't re-add

  await prisma.productImage.deleteMany({ where: { productId } });
  await prisma.productImage.createMany({
    data: [0, 1, 2].map((n) => ({
      productId,
      url: picsumUrl(slug, n),
      alt: `${slug.replace(/-/g, ' ')} ${n + 1}`,
      sort: n,
    })),
  });
}

async function upsertVariantAndSkus(
  productId: string,
  productSlug: string,
  basePrice: number,
  spec: ProductSpec,
): Promise<void> {
  const variant = await prisma.variant.upsert({
    where: { productId_name: { productId, name: spec.variant.name } },
    update: {},
    create: { productId, name: spec.variant.name },
    select: { id: true },
  });

  // Upsert options with explicit sort so the picker renders in spec order.
  for (const [idx, value] of spec.variant.options.entries()) {
    await prisma.variantOption.upsert({
      where: { variantId_value: { variantId: variant.id, value } },
      update: { sort: idx },
      create: { variantId: variant.id, value, sort: idx },
    });
  }

  // One SKU per option. Code = `<slug>-<value-slug>` so codes survive reseed.
  for (const [idx, value] of spec.variant.options.entries()) {
    const code = `${productSlug}-${value.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const delta = spec.priceDeltas?.[idx] ?? 0;
    const price = new Prisma.Decimal(basePrice + delta);
    await prisma.sku.upsert({
      where: { code },
      update: {
        price,
        stock: spec.stock ?? DEFAULT_STOCK,
        optionCombination: { [spec.variant.name]: value },
        productId,
      },
      create: {
        productId,
        code,
        price,
        stock: spec.stock ?? DEFAULT_STOCK,
        optionCombination: { [spec.variant.name]: value },
      },
    });
  }
}

export async function seedCatalog(): Promise<{
  categories: number;
  products: number;
  skus: number;
}> {
  let products = 0;
  let skus = 0;

  for (const cat of CATEGORIES) {
    const categoryId = await upsertCategory(cat);
    for (const p of cat.products) {
      const productId = await upsertProduct(categoryId, p);
      await upsertImages(productId, p.slug);
      await upsertVariantAndSkus(productId, p.slug, p.basePrice, p);
      products += 1;
      skus += p.variant.options.length;
    }
  }

  return { categories: CATEGORIES.length, products, skus };
}
