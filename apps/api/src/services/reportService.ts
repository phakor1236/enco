import { Prisma } from '@prisma/client';

import { prisma, type DbClient } from '../lib/db.js';

// Only PAID/SHIPPED/COMPLETED orders count as "sold".
// PENDING hasn't been paid; CANCELLED/REFUNDED reverse the sale.
const SOLD_STATUSES = Prisma.sql`('PAID', 'SHIPPED', 'COMPLETED')`;

export type DailyRow = { date: string; orderCount: number; revenue: string };
export type MonthlyRow = { month: string; orderCount: number; revenue: string };
export type ProductRow = {
  productId: string;
  productName: string;
  totalQty: number;
  revenue: string;
};

export async function getDailyReport(days: number, db: DbClient = prisma): Promise<DailyRow[]> {
  type Raw = { date: Date; order_count: bigint; revenue: Prisma.Decimal };
  const rows = await db.$queryRaw<Raw[]>`
    SELECT
      DATE(created_at)      AS date,
      COUNT(*)::bigint      AS order_count,
      COALESCE(SUM(total), 0) AS revenue
    FROM orders
    WHERE status IN ${SOLD_STATUSES}
      AND created_at >= NOW() - ${days} * INTERVAL '1 day'
    GROUP BY DATE(created_at)
    ORDER BY date DESC
  `;
  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    orderCount: Number(r.order_count),
    revenue: r.revenue.toFixed(2),
  }));
}

export async function getMonthlyReport(
  months: number,
  db: DbClient = prisma,
): Promise<MonthlyRow[]> {
  type Raw = { month: Date; order_count: bigint; revenue: Prisma.Decimal };
  const rows = await db.$queryRaw<Raw[]>`
    SELECT
      DATE_TRUNC('month', created_at) AS month,
      COUNT(*)::bigint                AS order_count,
      COALESCE(SUM(total), 0)         AS revenue
    FROM orders
    WHERE status IN ${SOLD_STATUSES}
      AND created_at >= NOW() - ${months} * INTERVAL '1 month'
    GROUP BY DATE_TRUNC('month', created_at)
    ORDER BY month DESC
  `;
  return rows.map((r) => ({
    month: r.month.toISOString().slice(0, 7),
    orderCount: Number(r.order_count),
    revenue: r.revenue.toFixed(2),
  }));
}

export async function getByProductReport(
  opts: { limit: number; startDate?: Date; endDate?: Date },
  db: DbClient = prisma,
): Promise<ProductRow[]> {
  type Raw = {
    product_id: string;
    product_name: string;
    total_qty: bigint;
    revenue: Prisma.Decimal;
  };

  const startFilter = opts.startDate
    ? Prisma.sql`AND o.created_at >= ${opts.startDate}`
    : Prisma.sql``;
  // endDate is an exclusive upper bound (start of the day AFTER the requested endDate)
  const endFilter = opts.endDate ? Prisma.sql`AND o.created_at < ${opts.endDate}` : Prisma.sql``;

  const rows = await db.$queryRaw<Raw[]>`
    SELECT
      p.id                           AS product_id,
      p.name                         AS product_name,
      SUM(oi.qty)::bigint            AS total_qty,
      COALESCE(SUM(oi.qty * oi.unit_price), 0) AS revenue
    FROM order_items oi
    JOIN orders  o ON oi.order_id   = o.id
    JOIN skus    s ON oi.sku_id     = s.id
    JOIN products p ON s.product_id = p.id
    WHERE o.status IN ${SOLD_STATUSES}
      ${startFilter}
      ${endFilter}
    GROUP BY p.id, p.name
    ORDER BY revenue DESC
    LIMIT ${opts.limit}
  `;
  return rows.map((r) => ({
    productId: r.product_id,
    productName: r.product_name,
    totalQty: Number(r.total_qty),
    revenue: r.revenue.toFixed(2),
  }));
}
