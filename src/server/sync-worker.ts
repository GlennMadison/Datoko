import { continueSyncJob } from "./sync-continuation.ts";
import { AppError, publicErrorCode } from "../core/errors.ts";
import { getDb } from "./db.ts";
import { liveConfig } from "./env.ts";
import { withShopLock } from "./connections.ts";
import { getQueue, type SyncJob } from "./queue.ts";
import { dispatchDueSyncs } from "./sync-dispatch.ts";
import { runShopSync } from "./sync.ts";
import { syncDueAds } from "./ads-sync.ts";

export async function runSyncBatch() {
  const config = liveConfig();
  // One scheduled batch at a time, including across cold starts/deployments.
  return withShopLock(`sync-worker:${config.SHOPEE_ENV}`, async () => {
    const deadline = Date.now() + 180_000;
    const boss = await getQueue();
    const db = getDb();
    await boss.supervise();
    const connectedShops = await dispatchDueSyncs();
    const jobs = await boss.fetch<SyncJob>("datoko.sync", { batchSize: 1, includeMetadata: true });
    let completed = 0, continued = 0, failed = 0;
    for (const job of jobs) {
      const lease = { id: job.id, retryCount: job.retryCount };
      try {
        const continuation = await runShopSync(job.data, { shouldPause: () => Date.now() >= deadline - 60_000 });
        if (continuation) {
          await continueSyncJob(boss, job, continuation);
          continued++;
        } else {
          await boss.complete("datoko.sync", lease);
          completed++;
        }
      } catch (error) {
        const code = publicErrorCode(error);
        await boss.fail("datoko.sync", lease, { code });
        const stored = await boss.getJobById("datoko.sync", job.id);
        if (stored?.state === "failed") await db.syncRun.updateMany({ where: { id: job.data.runId, status: { in: ["RUNNING", "RETRYING"] } }, data: { status: "FAILED", errorCode: code, finishedAt: new Date() } });
        console.error(JSON.stringify({ event: "sync_job_failed", code }));
        failed++;
      }
    }
    // Ads has its own schedule and errors; order failures must not stop it.
    let ads = { imported: 0, unchanged: 0, completed: 0, failed: 0 };
    try { ads = await syncDueAds({ shouldPause: () => Date.now() >= deadline - 25_000 }); }
    catch (error) { console.error(JSON.stringify({ event: "ads_batch_failed", code: publicErrorCode(error) })); ads.failed++; }
    return { connectedShops, completed, continued, failed, ads };
  });
}
