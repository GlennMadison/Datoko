import { test } from "node:test";
import assert from "node:assert/strict";
import { orderPage } from "../src/core/order-pagination.ts";
import { refreshDelay } from "../src/core/workspace-refresh.ts";

test("order paging bounds untrusted URL values and restricts SQL sort choices", () => {
  assert.deepEqual(orderPage({ page: "-2", size: "100000", sort: "profit; DROP TABLE orders", dir: "ASC" }),
    { page: 1, pageSize: 25, sort: "createdAt", direction: "desc", search: "", status: "" });
  assert.deepEqual(orderPage({ page: "2", size: "10", sort: "profit", dir: "asc", q: "Speaker", status: "COMPLETED" }),
    { page: 2, pageSize: 10, sort: "profit", direction: "asc", search: "Speaker", status: "COMPLETED" });
  assert.equal(orderPage({ q: "x".repeat(500) }).search.length, 200);
  assert.equal(orderPage({ page: ["1", "2"], sort: ["name"], status: "arbitrary" }).page, 1);
});

test("visible idle pages check at two minutes; active syncs check faster and errors back off", () => {
  assert.equal(refreshDelay(false), 120_000);
  assert.equal(refreshDelay(true), 15_000);
  assert.equal(refreshDelay(false, 1), 240_000);
  assert.equal(refreshDelay(true, 2), 60_000);
  assert.equal(refreshDelay(false, 100), 600_000);
});
