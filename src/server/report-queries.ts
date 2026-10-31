import { cache } from "react";
import { Prisma } from "../generated/prisma/client.ts";
import { getDb } from "./db.ts";

export const reportOrderSelect = {
  id: true, orderSn: true, status: true, paymentStatus: true, totalAmount: true, merchandiseAmount: true,
  sourceCreatedAt: true, sourceUpdatedAt: true,
  items: { select: { id: true, variantId: true, name: true, variationName: true, sku: true, sourceLineKey: true,
    quantity: true, paidUnitPrice: true, costSnapshot: true, costQuality: true,
    variant: { select: { sourceItemId: true } } }, orderBy: { id: "asc" as const } },
  returns: { select: { id: true, returnSn: true, status: true, confirmedRefund: true, sourceUpdatedAt: true } },
} satisfies Prisma.OrderSelect;

// Prisma's nested take can trim related records after fetching them. Perform
// latest-per-order selection in Postgres so revisions never cross the network.
export async function reportOrders(db: Prisma.TransactionClient, shopId: string, from: string, to: string, ids?: string[]) {
  if (ids && !ids.length) return [];
  const orders = await db.order.findMany({ where: { shopId, sourceCreatedAt: { gte: new Date(from), lt: new Date(to) }, ...(ids ? { id: { in: ids } } : {}) },
    select: reportOrderSelect, orderBy: [{ sourceCreatedAt: "desc" }, { id: "asc" }] });
  const snapshots = orders.length ? await db.$queryRaw<{ orderId: string; amounts: Prisma.JsonValue }[]>`
    SELECT DISTINCT ON (s."orderId") s."orderId", s.amounts
    FROM financial_snapshots s JOIN orders o ON o.id = s."orderId"
    WHERE o."shopId" = ${shopId} AND o."sourceCreatedAt" >= ${new Date(from)} AND o."sourceCreatedAt" < ${new Date(to)}
      AND s.source = 'SHOPEE_ESCROW' ${ids ? Prisma.sql`AND o.id IN (${Prisma.join(ids)})` : Prisma.empty}
    ORDER BY s."orderId", s.revision DESC` : [];
  const latest = new Map(snapshots.map(row => [row.orderId, row]));
  return orders.map(order => ({ ...order, financialSnapshots: latest.has(order.id) ? [latest.get(order.id)!] : [] }));
}

// Shared by current and comparison periods during one request.
export const reportProducts = cache(async (shopId: string) => {
  const db = getDb();
  const [variants, names, costs] = await Promise.all([
    db.productVariant.findMany({ where: { shopId }, select: { id: true, shopId: true, sourceItemId: true, sourceModelId: true,
      name: true, variationName: true, sku: true, createdAt: true } }),
    db.$queryRaw<{ variantId: string; name: string; sourceCreatedAt: Date }[]>`
      SELECT DISTINCT ON (i."variantId") i."variantId", i.name, o."sourceCreatedAt"
      FROM order_items i JOIN orders o ON o.id = i."orderId" JOIN product_variants v ON v.id = i."variantId"
      WHERE v."shopId" = ${shopId} AND o."shopId" = ${shopId}
      ORDER BY i."variantId", o."sourceCreatedAt" DESC, i.id ASC`,
    db.$queryRaw<{ variantId: string; amount: string }[]>`
      SELECT DISTINCT ON (c."variantId") c."variantId", c.amount::text
      FROM sku_cost_versions c JOIN product_variants v ON v.id = c."variantId"
      WHERE v."shopId" = ${shopId} AND c."effectiveAt" <= now()
      ORDER BY c."variantId", c."effectiveAt" DESC, c."createdAt" DESC, c.id ASC`,
  ]);
  const latestNames = new Map(names.map(row => [row.variantId, row]));
  const latestCosts = new Map(costs.map(row => [row.variantId, row]));
  return variants.map(variant => ({ ...variant, costs: latestCosts.has(variant.id) ? [latestCosts.get(variant.id)!] : [],
    orderItems: latestNames.has(variant.id) ? [{ name: latestNames.get(variant.id)!.name, order: { sourceCreatedAt: latestNames.get(variant.id)!.sourceCreatedAt } }] : [] }));
});

export async function reportReturns(db: Prisma.TransactionClient, shopId: string, from: string, to: string) {
  return db.returnCase.findMany({ where: { shopId, sourceUpdatedAt: { gte: new Date(from), lt: new Date(to) } },
    select: { id: true, returnSn: true, status: true, reportedAmount: true, confirmedRefund: true, sourceUpdatedAt: true, order: { select: { orderSn: true } } },
    orderBy: [{ sourceUpdatedAt: "desc" }, { id: "asc" }] });
}
