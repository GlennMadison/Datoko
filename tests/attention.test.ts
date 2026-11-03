import assert from "node:assert/strict";
import { test } from "node:test";
import { orderSyncIssue, processingCutoff } from "../src/core/attention.ts";

const now = new Date("2026-11-03T12:00:00Z");

test("awaiting processing includes one hour and one scheduled sync cycle", () => {
  assert.equal(processingCutoff(now, 10).toISOString(), "2026-11-03T10:50:00.000Z");
  assert.equal(processingCutoff(now, 30).toISOString(), "2026-11-03T10:30:00.000Z");
});

test("sync alerts distinguish failure, overdue sync, and recovery", () => {
  const connectedAt = new Date("2026-11-03T09:00:00Z");
  const recent = new Date("2026-11-03T11:50:00Z");
  const overdue = new Date("2026-11-03T11:40:00Z");
  assert.equal(orderSyncIssue(now, 10, { lastSuccessAt: recent, lastErrorCode: "SYNC_FAILED" }, connectedAt), "Order sync failed");
  assert.equal(orderSyncIssue(now, 10, { lastSuccessAt: overdue, lastErrorCode: null }, connectedAt), "Order sync is overdue");
  assert.equal(orderSyncIssue(now, 10, { lastSuccessAt: recent, lastErrorCode: null }, connectedAt), null);
  assert.equal(orderSyncIssue(now, 10, undefined, recent), null);
  assert.equal(orderSyncIssue(now, 10, undefined, connectedAt), "Order sync is overdue");
});
