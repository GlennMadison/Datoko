import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.toLowerCase().includes("test")) throw new Error("Set TEST_DATABASE_URL to a dedicated database with 'test' in its name.");
process.env.DATABASE_URL = url;
const { getDb, closeDb } = await import("../src/server/db.ts");
const { getQueue, enqueueSync } = await import("../src/server/queue.ts");

test("PostgreSQL durability guarantees", async t => {
  const db = getDb();
  const boss = await getQueue();
  t.after(async () => {
    try { await boss.stop({ graceful: true }); }
    finally { await closeDb(); }
  });
  const ownerId = `test-${randomUUID()}`;
  const sourceShopId = String(Date.now());
  await db.user.create({ data: { id: ownerId, name: "Test owner", email: `${ownerId}@example.test`, emailVerified: true } });
  const shop = await db.shop.create({ data: { ownerId, sourceShopId, environment: "sandbox", name: "Test shop" } });
  try {
    await t.test("connection save and queued import roll back together", async () => {
      await assert.rejects(db.$transaction(async tx => {
        await tx.shopConnection.create({ data: { shopId: shop.id } });
        await enqueueSync(tx, boss, { shopId: shop.id, generation: 1, reason: "TEST" });
        throw new Error("rollback-proof");
      }), /rollback-proof/);
      assert.equal(await db.shopConnection.count({ where: { shopId: shop.id } }), 0);
      assert.equal(await db.syncRun.count({ where: { shopId: shop.id } }), 0);
      const jobs = await db.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM pgboss.job WHERE data->>'shopId' = ${shop.id}`;
      assert.equal(jobs[0].count, 0);
    });
    await t.test("simultaneous manual requests share one durable job", async () => {
      await db.shopConnection.create({ data: { shopId: shop.id } });
      const [first, second] = await Promise.all([
        db.$transaction(tx => enqueueSync(tx, boss, { shopId: shop.id, generation: 1, reason: "TEST" })),
        db.$transaction(tx => enqueueSync(tx, boss, { shopId: shop.id, generation: 1, reason: "TEST" })),
      ]);
      assert.equal(first.jobId, second.jobId);
      assert.equal(await db.syncRun.count({ where: { shopId: shop.id } }), 1);
    });
    await t.test("financial effects have SQL-enforced duplicate protection", async () => {
      const now = new Date();
      const order = await db.order.create({ data: { shopId: shop.id, orderSn: `TEST-${randomUUID()}`, status: "COMPLETED", totalAmount: "110000", merchandiseAmount: "110000", sourceCreatedAt: now, sourceUpdatedAt: now } });
      const entry = { orderId: order.id, source: "verified-test-source", dedupeKey: "refund-1", component: "refunds", amount: "-40000", effectiveAt: now };
      await db.financialEntry.create({ data: entry });
      await assert.rejects(db.financialEntry.create({ data: entry }));
      const total = await db.financialEntry.aggregate({ where: { orderId: order.id }, _sum: { amount: true } });
      assert.equal(total._sum.amount?.toString(), "-40000");
    });
  } finally {
    await db.$executeRaw`DELETE FROM pgboss.job WHERE data->>'shopId' = ${shop.id}`;
    await db.financialEntry.deleteMany({ where: { order: { shopId: shop.id } } });
    await db.order.deleteMany({ where: { shopId: shop.id } });
    await db.syncRun.deleteMany({ where: { shopId: shop.id } });
    await db.shopConnection.deleteMany({ where: { shopId: shop.id } });
    await db.shop.delete({ where: { id: shop.id } });
    await db.user.delete({ where: { id: ownerId } });
  }
});
