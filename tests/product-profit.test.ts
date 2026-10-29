import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateProductAds, summarizeProductProfit, productProfitContributions } from "../src/core/product-profit.ts";
import { amountUnits } from "../src/core/money.ts";

const item = (itemId: string, price = "100000", cost: string | null = "40000", quantity = 1) => ({ itemId, paidUnitPrice: price, costSnapshot: cost, quantity });
const order = (items: ReturnType<typeof item>[], payout: string | null = "90000", status = "COMPLETED") => ({ items, payout, status });
const row = (campaignKey: string, spend: string, ids?: string[], day = "2026-10-01T17:00:00.000Z", grain: "DAY" | "HOUR" = "DAY") => ({ campaignKey, spend, start: day, grain, sourceMetrics: ids ? { advertisedItemIds: ids } : undefined });
const contributions = (base: ReturnType<typeof summarizeProductProfit>, ads: ReturnType<typeof allocateProductAds>) => productProfitContributions(base, ads, [{ sourceItemId: "speaker", name: "Speaker stand" }, { sourceItemId: "lamp", name: "Lamp" }]);

test("50k speaker profit loses its own 10k ads plus 11% PPN; organic product keeps all profit", () => {
  const base = summarizeProductProfit([order([item("speaker")]), order([item("lamp")], "70000")]);
  const ads = allocateProductAds([row("shop", "10000")], [row("campaign:1", "10000", ["speaker"])]);
  const result = contributions(base, ads);
  assert.equal(result.products[0].cleanProfit, "38900.0000");
  assert.equal(result.products[1].cleanProfit, "30000.0000");
  assert.equal(result.products[1].adSpend, "0.0000");
  assert.equal(result.total, "68900.0000");
  assert.equal(result.products[0].percentage, 56.45);
});

test("product IDs group renamed variants; quantity/COGS and mixed-order payout reconcile exactly", () => {
  const base = summarizeProductProfit([order([item("speaker", "1", "0.1", 2), item("lamp", "1", "0.2")], "1.0001"), order([item("speaker", "1", "0.1")], "0.2")]);
  assert.equal(base.products.length, 2);
  assert.equal(base.mixedOrders, 1);
  assert.equal(base.products.reduce((sum, row) => sum + amountUnits(row.profit), 0n), amountUnits("0.7001"));
});

test("cancelled/unpaid and incomplete-cost orders are excluded without inventing zero profit", () => {
  const base = summarizeProductProfit([order([item("speaker")], "90000", "CANCELLED"), order([item("speaker")], "90000", "UNPAID"), order([item("lamp", "100000", null)]), order([item("speaker")], null)]);
  assert.equal(base.eligible, 2);
  assert.equal(base.covered, 0);
  assert.deepEqual(base.products, []);
});

test("daily/hourly campaigns and shop totals are overlapping views, never summed twice", () => {
  const ads = allocateProductAds([row("shop", "10000")], [row("campaign:1", "10000", ["speaker"]), row("campaign:1", "10000", ["speaker"], undefined, "HOUR"), row("shop", "10000")]);
  assert.equal(ads.products[0].spend, "10000.0000");
  assert.equal(ads.totalSpend, "10000.0000");
  assert.equal(ads.unassignedSpend, "0.0000");
});

test("unmapped/shared campaigns stay separate and never charge organic products", () => {
  const ads = allocateProductAds([row("shop", "20000")], [row("campaign:1", "5000", ["speaker"]), row("campaign:2", "5000", ["speaker", "lamp"]), row("campaign:3", "7000")]);
  assert.equal(ads.unassignedSpend, "15000.0000");
  const result = contributions(summarizeProductProfit([order([item("lamp")])]), ads);
  assert.equal(result.products.find(row => row.itemId === "lamp")!.cleanProfit, "50000.0000");
  assert.equal(result.total, "27800.0000");
});

test("day-by-day mismatches cannot be hidden by another day; conflicting spend stays unassigned", () => {
  const ads = allocateProductAds([row("shop", "10000"), row("shop", "10000", undefined, "2026-10-02T17:00:00.000Z")], [row("campaign:1", "15000", ["speaker"])]);
  assert.deepEqual(ads.products, []);
  assert.equal(ads.unassignedSpend, "20000.0000");
});

test("ad-only products retain losses; negative profits never turn into positive pie slices", () => {
  const base = summarizeProductProfit([order([item("lamp")])]);
  const result = contributions(base, allocateProductAds([row("shop", "70000")], [row("campaign:1", "70000", ["speaker"])]));
  assert.equal(result.total, "-27700.0000");
  assert.equal(result.products.find(row => row.itemId === "speaker")!.percentage, null);
  assert.equal(result.products.find(row => row.itemId === "lamp")!.percentage, 100);
  assert.equal(result.hasLosses, true);
});

test("zero-value orders and fractional advertising remain finite and reconcile", () => {
  const base = summarizeProductProfit([order([item("speaker", "0", "0"), item("lamp", "0", "0")], "0.0001")]);
  const result = contributions(base, allocateProductAds([row("shop", "0.0001")], [row("campaign:1", "0.0001", ["speaker"])]));
  assert.equal(result.total, "0.0000");
  assert.ok(result.products.every(row => row.percentage === null || Number.isFinite(row.percentage)));
});
