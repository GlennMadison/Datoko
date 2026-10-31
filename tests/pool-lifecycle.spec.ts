import { test, mock } from "node:test";
import assert from "node:assert/strict";
const attached: unknown[] = [];
mock.module("@vercel/functions", { namedExports: { attachDatabasePool: (pool: unknown) => attached.push(pool) } });
process.env.VERCEL = "1";
process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";
delete process.env.DATABASE_SSL_CA;
const { getPool } = await import("../src/server/db.ts");

test("Vercel attaches one reusable application pool with a short idle timeout", async () => {
  const pool = getPool();
  assert.equal(getPool(), pool);
  assert.deepEqual(attached, [pool]);
  assert.equal(pool.options.maxUses, Infinity);
  assert.equal(pool.options.idleTimeoutMillis, 1000);
  assert.equal(pool.options.max, 5);
  await pool.end();
});

let unlockFailed = false, held = false;
const releases: boolean[] = [];
const client = { query: async (sql: string) => {
  if (sql.includes("pg_try_advisory_lock")) { held = true; return { rows: [{ locked: true }] }; }
  if (unlockFailed) throw new Error("unlock failed");
  held = false; return { rows: [] };
}, release: (destroy: boolean) => releases.push(destroy) };
mock.module("../src/server/db.ts", { namedExports: { getPool: () => ({ connect: async () => client }), getDb: () => ({}) } });
const { withShopLock } = await import("../src/server/connections.ts");

test("checked-out session locks survive actions and unlock before reuse", async () => {
  assert.equal(await withShopLock("fixture", async () => { assert.equal(held, true); return "done"; }), "done");
  assert.equal(held, false); assert.equal(releases.at(-1), false);
  await assert.rejects(withShopLock("fixture", async () => { throw new Error("action failed"); }), /action failed/);
  assert.equal(held, false); assert.equal(releases.at(-1), false);
});

test("an uncertain unlock destroys the client instead of returning a held lock to the pool", async () => {
  unlockFailed = true;
  await assert.rejects(withShopLock("fixture", async () => "done"), /unlock failed/);
  assert.equal(releases.at(-1), true);
});
