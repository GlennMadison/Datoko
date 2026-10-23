import { getQueue, type SyncJob } from "../server/queue.ts";
import { closeDb } from "../server/db.ts";
import { liveConfig } from "../server/env.ts";
import { dispatchDueSyncs } from "../server/sync-dispatch.ts";
import { runShopSync } from "../server/sync.ts";
import { publicErrorCode } from "../core/errors.ts";

let activeQueue: Awaited<ReturnType<typeof getQueue>> | undefined;

async function main() {
  const config = liveConfig();
  const boss = await getQueue();
  activeQueue = boss;
  let stopping = false;
  const dispatch = async () => {
    const connectedShops = await dispatchDueSyncs();
    console.log(JSON.stringify({ event: "worker_heartbeat", at: new Date().toISOString(), connectedShops }));
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
