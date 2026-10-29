import { test } from "node:test";
import assert from "node:assert/strict";
import { advertisingCost } from "../src/core/ads-cost.ts";
import { calculateRoas } from "../src/core/ads-roas.ts";
import { amountUnits } from "../src/core/money.ts";
import { productProfitContributions } from "../src/core/product-profit.ts";
import { profitAfterAdSpend } from "../src/core/overview-profit.ts";
import { costBreakdown } from "../src/core/cost-breakdown.ts";

test("100k Shopee spend costs 111k with PPN, without mutating or compounding source spend", () => {
  const source = { spend: "100000" };
  for (let i = 0; i < 3; i++) assert.deepEqual(advertisingCost(source.spend), {
    spend: "100000.0000", ppn: "11000.0000", total: "111000.0000",
  });
  assert.equal(source.spend, "100000");
  assert.deepEqual(advertisingCost(0), { spend: "0.0000", ppn: "0.0000", total: "0.0000" });
});

test("PPN uses ledger precision for fractional and large amounts and rejects invalid spend", () => {
  assert.deepEqual(advertisingCost("10000.1234"), { spend: "10000.1234", ppn: "1100.0136", total: "11100.1370" });
  assert.equal(advertisingCost("9007199254740993.0001").ppn, "990791918021509.2300");
  for (const value of [-1, "-0.0001", "NaN", "Infinity", "0.00001"]) assert.throws(() => advertisingCost(value));
});

test("source ROAS remains unchanged while all profit views deduct the same PPN-inclusive cost", () => {
  const source = calculateRoas([{ key: "shop", start: "2026-10-01T17:00:00Z", end: "2026-10-02T17:00:00Z", grain: "DAY", spend: "100000", revenue: "1000000", sourceAsOf: "2026-10-03T00:00:00Z", attributionComplete: false, outcomesComplete: false, allocations: [] }]);
  assert.equal(source.spend, "100000.0000");
  assert.equal(source.originalRoas, "10.00");
  const summary = { items: [], sales: "500000", profit: "200000", covered: 1, eligible: 1, estimated: 0, groupedFees: 0 };
  const pie = costBreakdown(summary, source.spend);
  const products = productProfitContributions({ products: [{ itemId: "stand", profit: "200000" }], covered: 1, eligible: 1, mixedOrders: 0 }, { products: [{ itemId: "stand", spend: source.spend }], totalSpend: source.spend, unassignedSpend: "0" }, []);
  assert.equal(profitAfterAdSpend(summary.profit, source.spend), 89000);
  assert.equal(pie.cleanProfit, "89000.0000");
  assert.equal(products.total, pie.cleanProfit);
  assert.equal(pie.slices.find(row => row.key === "ads_ppn")?.amount, "11000.0000");
  assert.equal(costBreakdown(summary, null).cleanProfit, null);
  assert.equal(costBreakdown(summary, source.spend, false).cleanProfit, null);
});

test("fractional product and unassigned PPN allocations reconcile exactly with shop profit", () => {
  const products = [{ itemId: "a", spend: "0.0005" }, { itemId: "b", spend: "0.0005" }];
  for (const unassigned of ["0", "0.0005"]) {
    const totalSpend = unassigned === "0" ? "0.0010" : "0.0015";
    const result = productProfitContributions({ products: [], covered: 0, eligible: 0, mixedOrders: 0 }, { products, totalSpend, unassignedSpend: unassigned }, []);
    const costs = result.products.reduce((sum, row) => sum + amountUnits(row.adSpend), amountUnits(result.unassignedSpend));
    assert.equal(costs, amountUnits(advertisingCost(totalSpend).total));
    assert.equal(Number(result.total), profitAfterAdSpend(0, totalSpend));
  }
});
