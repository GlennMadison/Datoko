import { PgBoss, fromPrisma } from "pg-boss";
import type { Prisma } from "../generated/prisma/client.ts";
import { AppError } from "../core/errors.ts";
import { databaseConnectionOptions } from "./database-connection.ts";

export type SyncJob = { runId: string; shopId: string; generation: number };
let starting: Promise<PgBoss> | undefined;
export async function getQueue(): Promise<PgBoss> {
  if (!starting) starting = (async () => {
    const boss = new PgBoss(databaseConnectionOptions());
    boss.on("error", () => console.error(JSON.stringify({ event: "queue_error" })));
    await boss.start();
    await boss.createQueue("datoko.sync", { retryLimit: 5, retryDelay: 30, retryBackoff: true, expireInSeconds: 1800 });
    await boss.createQueue("datoko.schedule", { retryLimit: 2, retryDelay: 30 });
    return boss;
  })().catch(error => { starting = undefined; throw error; });
  return starting;
}

export async function transactionLock(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked`;
}

export async function enqueueSync(tx: Prisma.TransactionClient, boss: PgBoss, input: { shopId: string; generation: number; reason: string }): Promise<{ runId: string; jobId: string }> {
  await transactionLock(tx, `sync-request:${input.shopId}`);
  const existing = await tx.syncRun.findFirst({ where: { shopId: input.shopId, generation: input.generation, status: { in: ["QUEUED", "RUNNING", "RETRYING"] } }, orderBy: { createdAt: "desc" } });
  if (existing?.jobId) {
    const job = await boss.getJobById("datoko.sync", existing.jobId);
    if (job && ["created", "retry", "active"].includes(job.state)) return { runId: existing.id, jobId: existing.jobId };
    await tx.syncRun.update({ where: { id: existing.id }, data: { status: "FAILED", finishedAt: new Date(), errorCode: "JOB_NO_LONGER_ACTIVE" } });
  }
  const run = await tx.syncRun.create({ data: { shopId: input.shopId, reason: input.reason, generation: input.generation } });
  const jobId = await boss.send("datoko.sync", { runId: run.id, shopId: input.shopId, generation: input.generation }, { db: fromPrisma(tx) });
  if (!jobId) throw new AppError("SYNC_ENQUEUE_FAILED", 503);
  await tx.syncRun.update({ where: { id: run.id }, data: { jobId } });
  return { runId: run.id, jobId };
}
