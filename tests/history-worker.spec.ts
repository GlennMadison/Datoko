import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../src/core/errors.ts";
import { HISTORY_START, historyWindow } from "../src/core/history-sync.ts";

// Exercise the real history runner without touching a database or live Shopee.
let run: any, state: any, requests: any[], orders: Map<string, any>, paused: boolean;
let list: (from: Date, to: Date, cursor: string | null) => Promise<any>;
const regularCheckpoint = new Date("2026-10-27");
const db: any = {
  syncRun: {
    findUnique: async () => run,
    findUniqueOrThrow: async () => run,
    update: async ({ data }: any) => Object.assign(run, data),
    updateMany: async ({ data }: any) => { Object.assign(run, data); return { count: 1 }; },
  },
  syncState: {
    upsert: async () => state,
    update: async ({ data }: any) => Object.assign(state, data),
    updateMany: async ({ data }: any) => Object.assign(state, data),
  },
  $queryRaw: async () => [{ version: 1, status: "CONNECTED" }],
  $transaction: async (fn: any) => fn(db),
  order: {
    findUnique: async ({ where }: any) => orders.get(where.shopId_orderSn.orderSn),
    upsert: async ({ create }: any) => { orders.set(create.orderSn, { ...create, id: create.orderSn }); return { id: create.orderSn }; },
  },
  orderHistory: { create: async () => {} },
};
mock.module("../src/server/db.ts", { namedExports: { getDb: () => db, getPool: () => {}, closeDb: async () => {} } });
mock.module("../src/server/connections.ts", { namedExports: {
  accessForShop: async () => ({ accessToken: "test", sourceShopId: "1" }),
  withShopLock: async (_: string, fn: () => any) => fn(),
} });
mock.module("../src/server/env.ts", { namedExports: { getConfig: () => ({ APP_BASE_URL: "https://datoko.example.test", SHOPEE_ENV: "production" }), partnerConfig: () => ({}) } });
mock.module("../src/server/shopee-client.ts", { namedExports: { ShopeeClient: class {
  async orderList(_token: string, _shop: string, from: Date, to: Date, cursor: string | null, field: string) {
    assert.equal(field, "create_time");
    requests.push({ from, to, cursor });
    return list(from, to, cursor);
  }
  async orderDetails(_token: string, _shop: string, sns: string[]) {
    return sns.map(sn => ({ order_sn: sn, order_status: "COMPLETED", currency: "IDR", total_amount: 100,
      create_time: Math.floor(new Date("2026-10-20T01:00:00Z").getTime() / 1000),
      update_time: Math.floor(new Date("2026-10-20T01:00:00Z").getTime() / 1000), item_list: [] }));
  }
} } });
const { runShopSync } = await import("../src/server/sync.ts");
const job = { runId: "run", shopId: "shop", generation: 1 };
function reset(through = new Date("2026-10-27")) {
  run = { id: "run", shopId: "shop", generation: 1, reason: "HISTORICAL", status: "QUEUED", processed: 0 };
  state = { id: "history", checkpoint: through, regularCheckpoint };
  requests = []; orders = new Map(); paused = false;
  list = async () => ({ orderSns: [], nextCursor: null });
}
test("history searches beyond 30 days and continues across empty periods", async () => {
  reset();
  for (let batch = 0; batch < 3; batch++) assert.ok(await runShopSync(job));
  assert.equal(requests.length, 9);
  assert.ok(state.checkpoint < new Date("2026-09-01"));
  assert.equal(state.regularCheckpoint, regularCheckpoint);
});
test("pause resumes the next page and commits counts only after a complete window", async () => {
  reset();
  list = async (_from, _to, cursor) => {
    if (!cursor) { paused = true; return { orderSns: ["OLDER"], nextCursor: "page2" }; }
    return { orderSns: [], nextCursor: null };
  };
  const continuation = await runShopSync(job, { shouldPause: () => paused });
  assert.ok(continuation);
  assert.equal(orders.size, 1);
  assert.equal(run.processed, 0);
  assert.equal(state.checkpoint.toISOString(), "2026-10-27T00:00:00.000Z");
  list = async () => ({ orderSns: [], nextCursor: null });
  await runShopSync({ ...job, continuation });
  assert.equal(requests[1].cursor, "page2");
  assert.equal(run.processed, 1);
  assert.equal(state.regularCheckpoint, regularCheckpoint);
});
test("provider failure preserves history position and regular sync checkpoint; retry resumes", async () => {
  reset();
  list = async () => { throw new AppError("SHOPEE_PERMISSION_DENIED", 403); };
  await assert.rejects(runShopSync(job), /SHOPEE_PERMISSION_DENIED/);
  assert.equal(state.checkpoint.toISOString(), "2026-10-27T00:00:00.000Z");
  assert.equal(state.lastErrorCode, "SHOPEE_PERMISSION_DENIED");
  assert.equal(state.regularCheckpoint, regularCheckpoint);
  list = async () => ({ orderSns: [], nextCursor: null });
  assert.ok(await runShopSync(job));
  assert.equal(state.lastErrorCode, null);
});
test("the final window is clamped to January 2015 and marks history complete", async () => {
  reset(new Date("2015-01-03"));
  assert.equal(await runShopSync(job), undefined);
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(state.checkpoint.getTime(), HISTORY_START.getTime());
  assert.equal(historyWindow(state.checkpoint), null);
  assert.equal(requests.length, 1);
});

test("history and regular requests are deduplicated independently", async () => {
  const { enqueueSync } = await import("../src/server/queue.ts");
  const runs: any[] = [];
  const jobs = new Map<string, any>();
  let sequence = 0;
  const tx: any = {
    $queryRaw: async () => [],
    syncRun: {
      findFirst: async ({ where }: any) => runs.find(r => r.shopId === where.shopId && (typeof where.reason === "string" ? r.reason === where.reason : r.reason !== where.reason.not)),
      create: async ({ data }: any) => { const r = { ...data, id: "run-" + ++sequence }; runs.push(r); return r; },
      update: async ({ where, data }: any) => Object.assign(runs.find(r => r.id === where.id), data),
    },
  };
  const boss: any = {
    send: async (_queue: string, data: any) => { const id = "job-" + data.runId; jobs.set(id, { state: "created" }); return id; },
    getJobById: async (_queue: string, id: string) => jobs.get(id),
  };
  const regular = await enqueueSync(tx, boss, { shopId: "shop", generation: 1, reason: "MANUAL" });
  const history = await enqueueSync(tx, boss, { shopId: "shop", generation: 1, reason: "HISTORICAL" });
  const repeated = await enqueueSync(tx, boss, { shopId: "shop", generation: 1, reason: "HISTORICAL" });
  assert.notEqual(history.runId, regular.runId);
  assert.equal(repeated.runId, history.runId);
  assert.equal(runs.length, 2);
});

test("history action rejects cross-origin and other shops before queueing", async () => {
  mock.module("../src/server/auth.ts", { namedExports: { requireUser: async () => ({ ownerId: "owner" }) } });
  db.shop = { findFirst: async ({ where }: any) => {
    assert.equal(where.ownerId, "owner");
    return null;
  } };
  const { POST } = await import("../src/app/api/shops/[shopId]/sync/route.ts");
  const context = { params: Promise.resolve({ shopId: "someone-elses-shop" }) };
  const foreign = await POST(new Request("https://datoko.example.test/api/shops/x/sync?scope=history", {
    method: "POST", headers: { Origin: "https://datoko.example.test" },
  }), context);
  assert.equal(foreign.status, 404);
  const crossOrigin = await POST(new Request("https://datoko.example.test/api/shops/x/sync?scope=history", {
    method: "POST", headers: { Origin: "https://evil.example" },
  }), context);
  assert.equal(crossOrigin.status, 403);
});
