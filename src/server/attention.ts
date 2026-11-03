import { unstable_cache } from "next/cache";
import type { Prisma } from "../generated/prisma/client.ts";
import { orderSyncIssue, processingCutoff } from "../core/attention.ts";
import { requireDashboardUser } from "./dashboard.ts";
import { getConfig, isDemo } from "./env.ts";
import { getDb } from "./db.ts";
import { reportCacheTag, reportShop } from "./report-context.ts";

async function attentionShop() {
  if (isDemo()) return null;
  const actor = await requireDashboardUser();
  return reportShop(actor.ownerId, getConfig().SHOPEE_ENV);
}

function awaitingProcessing(shopId: string, now: Date): Prisma.OrderWhereInput {
  return {
    shopId, status: "READY_TO_SHIP", paymentStatus: "PAID",
    paidAt: { lte: processingCutoff(now, getConfig().SYNC_INTERVAL_MINUTES) },
  };
}

function missingCost(shopId: string, now: Date): Prisma.ProductVariantWhereInput {
  const recent = new Date(now.getTime() - 90 * 86_400_000);
  return {
    shopId,
    costs: { none: { effectiveAt: { lte: now } } },
    orderItems: { some: { order: { shopId, status: "COMPLETED", sourceCreatedAt: { gte: recent, lte: now } } } },
  };
}

export async function getAttentionSummary() {
  const shop = await attentionShop();
  if (!shop) return { status: "no-shop" } as const;
  if (shop.connection?.status !== "CONNECTED") return { status: "disconnected" } as const;
  const now = new Date();
  const interval = getConfig().SYNC_INTERVAL_MINUTES;
  const issue = orderSyncIssue(now, interval, shop.syncStates.find(state => state.resource === "orders"), shop.connection.connectedAt);
  try {
    const [orders, costs] = await unstable_cache(async () => {
      const db = getDb();
      const checkedAt = new Date();
      return Promise.all([
        db.order.count({ where: awaitingProcessing(shop.id, checkedAt) }),
        db.productVariant.count({ where: missingCost(shop.id, checkedAt) }),
      ]);
    }, ["needs-attention-v1", shop.ownerId, shop.environment, shop.id, shop.reportVersion, String(interval)],
    { revalidate: 60, tags: [reportCacheTag(shop.ownerId, shop.environment)] })();
    return { status: "ready", orders, costs, issue } as const;
  } catch {
    return { status: "unavailable", issue } as const;
  }
}

export const attentionPageSize = 25;

export async function getAttentionPage(kind: "orders" | "costs", page: number) {
  const shop = await attentionShop();
  if (!shop || shop.connection?.status !== "CONNECTED") return null;
  const db = getDb();
  const now = new Date();
  const skip = (page - 1) * attentionPageSize;
  const take = attentionPageSize + 1;
  if (kind === "orders") {
    const orders = await db.order.findMany({
      where: awaitingProcessing(shop.id, now),
      orderBy: [{ paidAt: "asc" }, { id: "asc" }],
      select: { orderSn: true, paidAt: true },
      skip, take,
    });
    return { kind, rows: orders.slice(0, attentionPageSize), hasNext: orders.length > attentionPageSize };
  }
  const variants = await db.productVariant.findMany({
    where: missingCost(shop.id, now),
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, variationName: true, sku: true },
    skip, take,
  });
  return { kind, rows: variants.slice(0, attentionPageSize), hasNext: variants.length > attentionPageSize };
}
