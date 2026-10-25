import { getDb } from "./db.ts";
import { accessForShop, withShopLock } from "./connections.ts";
import { ShopeeClient } from "./shopee-client.ts";
import { partnerConfig } from "./env.ts";
import { normalizeSettlement } from "../core/profit.ts";
import { AppError, publicErrorCode } from "../core/errors.ts";
import { digest } from "../core/security.ts";

export async function syncShopFinance(shopId: string, generation: number, options: { orderSn?: string; shouldPause?: () => boolean; limit?: number } = {}) {
  return withShopLock(`finance-sync:${shopId}`, async () => {
    const db = getDb();
    const client = new ShopeeClient(partnerConfig());
    const stale = new Date(Date.now() - 6 * 3_600_000);
    const orders = await db.order.findMany({ where: { shopId, ...(options.orderSn ? { orderSn: options.orderSn } : { status: { notIn: ["CANCELLED", "IN_CANCEL", "UNPAID"] }, NOT: { financialSnapshots: { some: { source: "SHOPEE_ESCROW", observedAt: { gte: stale } } } } }) }, orderBy: [{ status: "asc" }, { sourceCreatedAt: "desc" }, { id: "asc" }], take: options.limit ?? 25 });
    let synced = 0, failed = 0;
    let lastError: string | null = null;
    for (const order of orders) {
      if (options.shouldPause?.()) break;
      try {
        let access = await accessForShop(shopId, generation);
        let raw: Record<string, unknown>;
        try { raw = await client.escrowDetail(access.accessToken, access.sourceShopId, order.orderSn); }
        catch (error) {
          if (!(error instanceof AppError) || error.code !== "SHOPEE_ACCESS_EXPIRED") throw error;
          access = await accessForShop(shopId, generation, access.accessToken);
          raw = await client.escrowDetail(access.accessToken, access.sourceShopId, order.orderSn);
        }
        const amounts = normalizeSettlement(raw, order.orderSn);
        const hash = digest(JSON.stringify(amounts));
        await db.$transaction(async tx => {
          const connection = await tx.$queryRaw<{ version: number; status: string }[]>`SELECT version, status FROM shop_connections WHERE "shopId" = ${shopId} FOR SHARE`;
          if (connection[0]?.version !== generation || connection[0]?.status !== "CONNECTED") throw new AppError("CONNECTION_CHANGED", 409);
          const previous = await tx.financialSnapshot.findFirst({ where: { orderId: order.id, source: "SHOPEE_ESCROW" }, orderBy: { revision: "desc" } });
          if (previous?.hash === hash) await tx.financialSnapshot.update({ where: { id: previous.id }, data: { observedAt: new Date() } });
          else await tx.financialSnapshot.create({ data: { orderId: order.id, source: "SHOPEE_ESCROW", sourceKey: order.orderSn, hash, revision: (previous?.revision ?? 0) + 1, amounts } });
        });
        synced++;
      } catch (error) {
        lastError = publicErrorCode(error); failed++;
        if (["CONNECTION_CHANGED", "SHOPEE_RECONNECT_REQUIRED", "SHOPEE_PERMISSION_DENIED", "SHOPEE_RATE_LIMIT", "SHOPEE_REQUEST_UNCERTAIN"].includes(lastError)) break;
      }
    }
    await db.syncState.upsert({ where: { shopId_resource: { shopId, resource: "finance" } }, create: { shopId, resource: "finance", lastSuccessAt: synced ? new Date() : null, lastErrorCode: lastError }, update: { ...(synced ? { lastSuccessAt: new Date() } : {}), lastErrorCode: lastError } });
    return { synced, failed, lastError };
  });
}
