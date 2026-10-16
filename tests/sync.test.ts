import { test } from "node:test";
import assert from "node:assert/strict";
import { syncWindows, importWindow, initialCoverageFrom } from "../src/core/sync.ts";
import { financialDeltas, amountUnits, amountString } from "../src/core/money.ts";

test("a failure on a later page preserves the old checkpoint; replay is safe", async () => {
  const window = { from: new Date("2026-10-14T00:00:00Z"), to: new Date("2026-10-15T00:00:00Z") };
  let checkpoint = window.from;
  const stored = new Map<string, number>();
  let fail = true;
  const source = { page: async (_: unknown, cursor: string | null) => {
    if (cursor === "page2" && fail) throw new Error("rate limited");
    return cursor ? { records: [{ id: "B", value: 2 }], nextCursor: null } : { records: [{ id: "A", value: 1 }], nextCursor: "page2" };
  } };
  const sink = { save: async (record: { id: string; value: number }) => { stored.set(record.id, record.value); }, commitCheckpoint: async (through: Date) => { checkpoint = through; } };
  await assert.rejects(importWindow(window, source, sink));
  assert.equal(checkpoint, window.from);
  assert.equal(stored.size, 1);
  fail = false;
  await importWindow(window, source, sink);
  assert.equal(stored.size, 2);
  assert.equal(checkpoint, window.to);
});

test("overlap catches boundaries, and a fixed upper bound leaves indexing time", () => {
  const windows = syncWindows({ checkpoint: new Date("2026-10-15T12:00:00Z"), coverageFrom: new Date("2026-10-01"), now: new Date("2026-10-15T12:10:00Z"), maxWindowDays: 7, historyDays: 90 });
  assert.equal(windows[0].from.toISOString(), "2026-10-15T11:55:00.000Z");
  assert.equal(windows.at(-1)!.to.toISOString(), "2026-10-15T12:09:00.000Z");
});

test("two-day outage is split into supported bounded windows", () => {
  const windows = syncWindows({ checkpoint: new Date("2026-10-13T00:00:00Z"), coverageFrom: new Date("2026-10-01"), now: new Date("2026-10-15T00:00:00Z"), maxWindowDays: 1, historyDays: 90 });
  assert.equal(windows.length, 3);
  assert.equal(windows[0].to.getTime(), windows[1].from.getTime());
});

test("outages beyond source history are explicit gaps", () => {
  assert.throws(() => syncWindows({ checkpoint: new Date("2026-01-01"), coverageFrom: new Date("2026-01-01"), now: new Date("2026-10-15"), maxWindowDays: 7, historyDays: 90 }), /HISTORY_COVERAGE_GAP/);
});

test("a retried cold import does not immediately fall off the moving history boundary", () => {
  const firstRun = new Date("2026-10-15T12:00:00Z");
  const coverageFrom = initialCoverageFrom(firstRun, 30, 30);
  const retryAt = new Date(firstRun.getTime() + 20 * 60_000);
  const windows = syncWindows({ checkpoint: null, coverageFrom, now: retryAt, maxWindowDays: 7, historyDays: 30 });
  assert.equal(windows[0].from, coverageFrom);
  assert.ok(windows.length > 0);
});

test("repeated cursors cannot silently loop and advance a checkpoint", async () => {
  let committed = false;
  await assert.rejects(importWindow({ from: new Date(0), to: new Date(1) }, { page: async () => ({ records: [], nextCursor: "same" }) }, { save: async () => {}, commitCheckpoint: async () => { committed = true; } }), /REPEATED_SOURCE_CURSOR/);
  assert.equal(committed, false);
});

test("late partial refund changes retained sales once; corrections reverse deltas", () => {
  const sale = { sales: "110000", refunds: "0", fees: "0" };
  const refunded = { ...sale, refunds: "40000" };
  assert.deepEqual(financialDeltas(null, sale), [{ component: "sales", amount: "110000.0000" }]);
  assert.deepEqual(financialDeltas(sale, refunded), [{ component: "refunds", amount: "-40000.0000" }]);
  assert.deepEqual(financialDeltas(refunded, refunded), []);
  assert.deepEqual(financialDeltas(refunded, { ...refunded, refunds: "30000" }), [{ component: "refunds", amount: "10000.0000" }]);
  const retained = amountUnits(refunded.sales) - amountUnits(refunded.refunds);
  assert.equal(amountString(retained), "70000.0000");
});

test("money arithmetic is exact and rejects unsupported precision", () => {
  assert.equal(amountString(amountUnits("0.1") + amountUnits("0.2")), "0.3000");
  assert.throws(() => amountUnits("0.00001"));
  assert.throws(() => financialDeltas(null, { sales: "110000", refunds: "-1", fees: "0" }));
});
