import { getQueue, enqueueSync, type SyncJob } from "../server/queue.ts";
import { getDb, closeDb } from "../server/db.ts";
import { liveConfig } from "../server/env.ts";
import { accessForShop } from "../server/connections.ts";
import { runShopSync } from "../server/sync.ts";
import { publicErrorCode } from "../core/errors.ts";

let activeQueue: Awaited<ReturnType<typeof getQueue>> | undefined;

async function main() {
  const config = liveConfig();
  const db = getDb();
  const boss = await getQueue();
  activeQueue = boss;
  let stopping = false;
  const dispatch = async () => {
    const shops = await db.shop.findMany({ where: { environment: config.SHOPEE_ENV, owner: { email: { equals: config.OWNER_EMAIL!, mode: "insensitive" } }, connection: { status: "CONNECTED" } }, include: { connection: true, syncStates: true } });
    for (const shop of shops) {
      const connection = shop.connection!;
      if (!connection.accessExpiresAt || connection.accessExpiresAt.getTime() <= Date.now() + 600_000) {
        try { await accessForShop(shop.id, connection.version); }
        catch (error) { console.error(JSON.stringify({ event: "refresh_failed", shopId: shop.id, code: publicErrorCode(error) })); continue; }
      }
      const orders = shop.syncStates.find(state => state.resource === "orders");
      // The queue already performs bounded retries. After an unresolved source
      // error, require an explicit retry rather than creating an endless loop.
      if (orders?.lastErrorCode) continue;
      if (!orders?.lastSuccessAt || orders.lastSuccessAt.getTime() < Date.now() - config.SYNC_INTERVAL_MINUTES * 60_000) {
        await db.$transaction(tx => enqueueSync(tx, boss, { shopId: shop.id, generation: connection.version, reason: "SCHEDULED" }));
      }
    }
    console.log(JSON.stringify({ event: "worker_heartbeat", at: new Date().toISOString(), connectedShops: shops.length }));
  };
  await boss.work<SyncJob>("datoko.sync", async jobs => {
    for (const job of jobs) await runShopSync(job.data);
  });
  await boss.work("datoko.schedule", async () => { await dispatch(); });
  await boss.schedule("datoko.schedule", "* * * * *", {});
  await dispatch();
  console.log(JSON.stringify({ event: "worker_started", environment: config.SHOPEE_ENV }));
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await boss.stop({ graceful: true, timeout: 25_000 });
    await closeDb();
  };
  process.once("SIGTERM", () => { void stop(); });
  process.once("SIGINT", () => { void stop(); });
}

main().catch(async error => {
  console.error(JSON.stringify({ event: "worker_start_failed", code: publicErrorCode(error) }));
  try { await activeQueue?.stop({ graceful: false }); }
  finally { await closeDb(); }
  process.exitCode = 1;
});
