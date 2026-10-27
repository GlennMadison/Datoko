import { getDb } from "./db.ts";
import { accessForShop, withShopLock } from "./connections.ts";
import { getConfig, partnerConfig } from "./env.ts";
import { ShopeeClient } from "./shopee-client.ts";
import { AppError, publicErrorCode } from "../core/errors.ts";
import { arrangeShipment } from "../core/shipment-workflow.ts";
import { packageNumber, type CourierChannel } from "../core/courier-shipping.ts";
import { ARRANGED_STATUSES, PROCESSING_WAIT_MS } from "../core/auto-process.ts";

export async function setAutoProcessing(shopId: string, ownerId: string, enabled: boolean) {
  return withShopLock(`auto-process:${shopId}`, async () => {
    const db = getDb();
    const shop = await db.shop.findFirst({ where: { id: shopId, ownerId, environment: getConfig().SHOPEE_ENV }, include: { connection: true } });
    if (!shop) throw new AppError("SHOP_NOT_FOUND", 404);
    if (enabled && shop.connection?.status !== "CONNECTED") throw new AppError("SHOPEE_RECONNECT_REQUIRED", 409);
    if (enabled && !await db.courierAutomation.count({ where: { shopId, enabled: true } })) throw new AppError("NO_COURIERS_ENABLED", 409);
    const current = await db.orderAutomation.findUnique({ where: { shopId } });
    return db.orderAutomation.upsert({
      where: { shopId },
      create: { shopId, enabled, enabledFrom: new Date(), updatedBy: ownerId },
      update: { enabled, updatedBy: ownerId, ...(enabled && !current?.enabled ? { enabledFrom: new Date() } : {}) },
    });
  });
}

export async function processDueOrders(controls: { shouldPause?: () => boolean } = {}) {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return { checked: 0, failed: 0 };
  const db = getDb();
  const settings = await db.orderAutomation.findMany({
    where: { enabled: true, shop: { environment: getConfig().SHOPEE_ENV, connection: { status: "CONNECTED" } } },
    include: { shop: { include: { connection: true } } }, orderBy: { lastRunAt: { sort: "asc", nulls: "first" } }, take: 10,
  });
  let checked = 0, failed = 0;
  for (const setting of settings) {
    if (controls.shouldPause?.()) break;
    try {
      await withShopLock(`auto-process:${setting.shopId}`, async () => {
        const current = await db.orderAutomation.findUniqueOrThrow({ where: { shopId: setting.shopId } });
        if (!current.enabled) return;
        const client = new ShopeeClient(partnerConfig());
        const generation = setting.shop.connection!.version;
        const read = async <T>(fn: (token: string, shop: string) => Promise<T>): Promise<T> => {
          const access = await accessForShop(setting.shopId, generation);
          try { return await fn(access.accessToken, access.sourceShopId); }
          catch (error) {
            if (!(error instanceof AppError) || error.code !== "SHOPEE_ACCESS_EXPIRED") throw error;
            const refreshed = await accessForShop(setting.shopId, generation, access.accessToken);
            return fn(refreshed.accessToken, refreshed.sourceShopId);
          }
        };
        const readOrder = async (sn: string) => (await read((token, shop) => client.processingOrder(token, shop, sn)));

        // A crashed/lost response is read-only reconciliation, never a second write.
        const uncertain = await db.orderProcessing.findMany({ where: { shopId: setting.shopId, status: { in: ["REQUESTED", "UNCERTAIN"] }, updatedAt: { lt: new Date(Date.now() - 300_000) } }, include: { order: true }, take: 3, orderBy: { updatedAt: "asc" } });
        for (const attempt of uncertain) {
          if (controls.shouldPause?.()) break;
          const order = await readOrder(attempt.order.orderSn);
          const arranged = ARRANGED_STATUSES.includes(String(order.order_status));
          await db.orderProcessing.update({ where: { id: attempt.id }, data: { status: arranged ? "ARRANGED" : "REVIEW", errorCode: arranged ? null : "REQUEST_INTERRUPTED" } });
        }
        const retryBefore = new Date(Date.now() - 600_000);
        const candidates = await db.order.findMany({
          where: {
            shopId: setting.shopId, status: "READY_TO_SHIP",
            sourceCreatedAt: { gte: current.enabledFrom, lte: new Date(Date.now() - PROCESSING_WAIT_MS) },
            OR: [
              { processing: null },
              { processing: { status: { in: ["CHECKING", "WAITING", "READ_FAILED"] }, checks: { lt: 144 }, updatedAt: { lt: retryBefore } } },
            ],
          }, orderBy: { sourceCreatedAt: "asc" }, take: 3,
        });
        let lastError: string | null = null;
        for (const order of candidates) {
          if (controls.shouldPause?.()) break;
          const attempt = await db.orderProcessing.upsert({ where: { orderId: order.id }, create: { orderId: order.id, shopId: setting.shopId, status: "CHECKING", checks: 1 }, update: { status: "CHECKING", checks: { increment: 1 }, errorCode: null } });
          await arrangeShipment(order.orderSn, current.enabledFrom, {
            readRule: async channelId => {
              const channels = current.channels as CourierChannel[];
              if (!channels.some(c => c.id === channelId && c.enabled)) return null;
              const rule = await db.courierAutomation.findUnique({ where: { shopId_channelId: { shopId: setting.shopId, channelId } } });
              await db.orderProcessing.update({ where: { id: attempt.id }, data: { channelId, method: rule?.method ?? null } });
              return rule;
            },
            readOrder: () => readOrder(order.orderSn),
            readParameters: fresh => read((token, shop) => client.shippingParameters(token, shop, order.orderSn, packageNumber(fresh))),
            claimRequest: async (channelId, method) => {
              if (controls.shouldPause?.()) return false;
              // Refresh/access validation occurs BEFORE the durable request marker.
              // Do not retry a ship_order write, including on token/HTTP errors.
              const connection = await db.shopConnection.findFirst({ where: { shopId: setting.shopId, status: "CONNECTED", version: generation } });
              if (!connection) throw new AppError("CONNECTION_CHANGED", 409);
              const claimed = await db.orderProcessing.updateMany({ where: { id: attempt.id, status: "CHECKING" }, data: { status: "REQUESTED", requestedAt: new Date(), channelId, method } });
              return claimed.count === 1;
            },
            send: async body => {
              const access = await accessForShop(setting.shopId, generation);
              return client.arrangeShipment(access.accessToken, access.sourceShopId, body);
            },
            save: async (status, code) => {
              lastError = ["REVIEW", "UNCERTAIN", "READ_FAILED"].includes(status) ? code ?? null : null;
              await db.orderProcessing.update({ where: { id: attempt.id }, data: { status, errorCode: code ?? null } });
            },
          });
          checked++;
        }
        // Waiting is normal, but exhausting preflight checks needs visible review.
        await db.orderProcessing.updateMany({ where: { shopId: setting.shopId, status: { in: ["READ_FAILED", "WAITING"] }, checks: { gte: 144 } }, data: { status: "REVIEW", errorCode: "PREFLIGHT_RETRY_EXHAUSTED" } });
        await db.orderAutomation.update({ where: { shopId: setting.shopId }, data: { lastRunAt: new Date(), lastErrorCode: lastError } });
      });
    } catch (error) {
      const code = publicErrorCode(error);
      if (code === "SHOP_JOB_BUSY") continue;
      failed++;
      await db.orderAutomation.update({ where: { shopId: setting.shopId }, data: { lastRunAt: new Date(), lastErrorCode: code } });
      console.error(JSON.stringify({ event: "auto_processing_failed", code }));
    }
  }
  return { checked, failed };
}
