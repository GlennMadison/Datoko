import { getDb } from "./db.ts";
import { accessForShop, withShopLock } from "./connections.ts";
import { ShopeeClient } from "./shopee-client.ts";
import { partnerConfig } from "./env.ts";
import { normalizeOrder } from "../core/orders.ts";
import { AppError } from "../core/errors.ts";

// Enrich old imports by their provider IDs. Monetary and cost snapshots stay intact.
export async function syncVariationNames(shopId: string, generation: number, controls: { shouldPause?: () => boolean } = {}) {
  return withShopLock(`order-details:${shopId}`, async () => {
    const db = getDb();
    const orders = await db.order.findMany({ where: { shopId, OR: [{ paymentStatus: "UNKNOWN" }, { items: { some: { variationName: null, variant: { sourceModelId: { not: "0" } } } } }] }, orderBy: { sourceCreatedAt: "desc" }, take: 250, select: { orderSn: true } });
    const client = new ShopeeClient(partnerConfig());
    let processed = 0, labels = 0;
    for (let offset = 0; offset < orders.length; offset += 50) {
      if (controls.shouldPause?.()) break;
      const requested = orders.slice(offset, offset + 50).map(order => order.orderSn);
      let access = await accessForShop(shopId, generation);
      let raw: unknown[];
      try { raw = await client.orderDetails(access.accessToken, access.sourceShopId, requested); }
      catch (error) {
        if (!(error instanceof AppError) || error.code !== "SHOPEE_ACCESS_EXPIRED") throw error;
        access = await accessForShop(shopId, generation, access.accessToken);
        raw = await client.orderDetails(access.accessToken, access.sourceShopId, requested);
      }
      for (const source of raw.map(normalizeOrder).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
        if (!requested.includes(source.orderSn)) throw new AppError("UNEXPECTED_SOURCE_ORDER", 502);
        labels += await db.$transaction(async tx => {
          const connection = await tx.$queryRaw<{ version: number; status: string }[]>`SELECT version, status FROM shop_connections WHERE "shopId" = ${shopId} FOR SHARE`;
          if (connection[0]?.version !== generation || connection[0]?.status !== "CONNECTED") throw new AppError("CONNECTION_CHANGED", 409);
          const order = await tx.order.findUniqueOrThrow({ where: { shopId_orderSn: { shopId, orderSn: source.orderSn } } });
          await tx.order.update({ where: { id: order.id }, data: { ...(source.paymentStatus !== "UNKNOWN" ? { paymentStatus: source.paymentStatus, paidAt: source.paidAt } : {}), ...(source.cancelReason ? { cancelReason: source.cancelReason } : {}) } });
          let count = 0;
          for (const item of source.items) {
            if (!item.variationName) continue;
            const variant = await tx.productVariant.findUnique({ where: { shopId_sourceItemId_sourceModelId: { shopId, sourceItemId: item.itemId, sourceModelId: item.modelId } } });
            if (!variant) continue;
            const updated = await tx.orderItem.updateMany({ where: { orderId: order.id, variantId: variant.id, variationName: null }, data: { variationName: item.variationName } });
            count += updated.count;
            // A historical replay cannot replace a newer known variation label.
            const newer = await tx.orderItem.findFirst({ where: { variantId: variant.id, variationName: { not: null }, order: { sourceCreatedAt: { gt: source.createdAt } } }, select: { id: true } });
            if (!newer) await tx.productVariant.update({ where: { id: variant.id }, data: { variationName: item.variationName } });
          }
          return count;
        });
        processed++;
      }
    }
    await db.syncState.upsert({ where: { shopId_resource: { shopId, resource: "order-details" } }, create: { shopId, resource: "order-details", lastSuccessAt: new Date() }, update: { lastSuccessAt: new Date(), lastErrorCode: null } });
    return { processed, labels };
  });
}
