import { fromPrisma } from "pg-boss";
import { AppError, publicErrorCode } from "../core/errors.ts";
import { getDb } from "./db.ts";
import { liveConfig } from "./env.ts";
import { withShopLock } from "./connections.ts";
import { getQueue, transactionLock, type SyncJob } from "./queue.ts";
import { dispatchDueSyncs } from "./sync-dispatch.ts";
import { runShopSync } from "./sync.ts";

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
          await db.$transaction(async tx => {
            await transactionLock(tx, `sync-request:${job.data.shopId}`);
            const connection = await tx.$queryRaw<{ status: string; version: number }[]>`SELECT status, version FROM shop_connections WHERE "shopId" = ${job.data.shopId} FOR SHARE`;
            if (connection[0]?.status !== "CONNECTED" || connection[0]?.version !== job.data.generation) throw new AppError("CONNECTION_CHANGED", 409);
            const held = await tx.$queryRaw<{ state: string; retryCount: number }[]>`SELECT state::text, retry_count AS "retryCount" FROM pgboss.job WHERE name = 'datoko.sync' AND id = ${job.id}::uuid FOR UPDATE`;
            if (held[0]?.state !== "active" || held[0]?.retryCount !== job.retryCount) throw new AppError("JOB_LEASE_LOST", 409);
            const current = await tx.syncRun.findFirst({ where: { id: job.data.runId, status: "RUNNING", shop: { connection: { status: "CONNECTED", version: job.data.generation } } } });
            if (!current) throw new AppError("CONNECTION_CHANGED", 409);
            const nextId = await boss.send("datoko.sync", { ...job.data, continuation }, { db: fromPrisma(tx) });
            if (!nextId) throw new AppError("SYNC_ENQUEUE_FAILED", 503);
            await boss.complete("datoko.sync", lease, { continued: true }, { db: fromPrisma(tx) });
            await tx.syncRun.update({ where: { id: current.id }, data: { jobId: nextId, status: "QUEUED", finishedAt: null, errorCode: null } });
          });
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
    return { connectedShops, completed, continued, failed };
  });
}
