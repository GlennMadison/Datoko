import { fromPrisma, type PgBoss } from "pg-boss";
import { AppError } from "../core/errors.ts";
import { getDb } from "./db.ts";
import { transactionLock, type SyncJob, type SyncContinuation } from "./queue.ts";

export async function continueSyncJob(boss: PgBoss, job: { id: string; retryCount: number; data: SyncJob }, continuation: SyncContinuation) {
  const db = getDb();
  const lease = { id: job.id, retryCount: job.retryCount };
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
}
