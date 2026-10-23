import { getDb } from "./db.ts";
import { liveConfig } from "./env.ts";
import { getQueue, enqueueSync } from "./queue.ts";
import { accessForShop } from "./connections.ts";
import { publicErrorCode } from "../core/errors.ts";

export async function dispatchDueSyncs(): Promise<number> {
  const config = liveConfig();
  const db = getDb();
  const boss = await getQueue();
  const shops = await db.shop.findMany({ where: { environment: config.SHOPEE_ENV, owner: { email: { equals: config.OWNER_EMAIL!, mode: "insensitive" } }, connection: { status: "CONNECTED" } }, include: { connection: true, syncStates: true } });
  for (const shop of shops) {
    const connection = shop.connection!;
    if (!connection.accessExpiresAt || connection.accessExpiresAt.getTime() <= Date.now() + 600_000) {
      try { await accessForShop(shop.id, connection.version); }
      catch (error) { console.error(JSON.stringify({ event: "refresh_failed", shopId: shop.id, code: publicErrorCode(error) })); continue; }
    }
    const orders = shop.syncStates.find(state => state.resource === "orders");
    if (orders?.lastErrorCode) continue;
    if (!orders?.lastSuccessAt || orders.lastSuccessAt.getTime() < Date.now() - config.SYNC_INTERVAL_MINUTES * 60_000) {
      await db.$transaction(tx => enqueueSync(tx, boss, { shopId: shop.id, generation: connection.version, reason: "SCHEDULED" }));
    }
  }
  return shops.length;
}
