import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSettlement, calculateOrderProfit, readSettlement } from "../src/core/profit.ts";

function income(payout: string, extra: Record<string, unknown> = {}) {
  return normalizeSettlement({ order_sn: "order1", order_income: { escrow_amount: payout, ...extra } }, "order1");
}
const order = (cost: string | null = "26000", quantity = 1, status = "COMPLETED", costQuality = "BIGSELLER_HISTORICAL") => ({ status, items: [{ costSnapshot: cost, quantity, costQuality }] });

test("settled profit uses provider payout without double deducting fees", () => {
  const settlement = income("95000", { commission_fee: "10000", service_fee: "9000", seller_order_processing_fee: "2000" });
  assert.equal(calculateOrderProfit(order(), settlement).profit, "69000.0000");
  assert.equal(calculateOrderProfit(order(), settlement).quality, "SETTLED");
});
test("separate orders use their own payouts and cost snapshots", () => {
  for (const [payout, cost, expected] of [["110000", "24000", "86000.0000"], ["103000", "23000", "80000.0000"], ["27000", "7000", "20000.0000"]]) assert.equal(calculateOrderProfit(order(cost), income(payout)).profit, expected);
});
test("quantity and fractional IDR remain exact", () => {
  const result = calculateOrderProfit(order("8123.45", 4), income("82000.1234"));
  assert.equal(result.cogs, "32493.8000"); assert.equal(result.profit, "49506.3234");
});
test("refunds, affiliate fees and negative adjustments are included only once", () => {
  const settlement = income("100000", { escrow_amount_after_adjustment: "70000", seller_return_refund: "-30000", order_ams_commission_fee: "5000" });
  assert.equal(settlement.adjustment, "-30000.0000"); assert.equal(settlement.refunds, "30000.0000");
  assert.equal(calculateOrderProfit(order("20000"), settlement).profit, "50000.0000");
});
test("zero payouts and losses are valid while absent payouts remain unknown", () => {
  assert.equal(calculateOrderProfit(order("20000"), income("0")).profit, "-20000.0000");
  assert.equal(calculateOrderProfit(order("0"), income("0")).profit, "0.0000");
  assert.equal(calculateOrderProfit(order(), null).quality, "MISSING_SETTLEMENT");
  assert.throws(() => normalizeSettlement({ order_sn: "order1", order_income: {} }, "order1"), /SETTLEMENT_NOT_AVAILABLE/);
});
test("missing costs and mixed-item orders cannot report invented profit", () => {
  assert.equal(calculateOrderProfit(order(null), income("10000")).profit, null);
  assert.equal(calculateOrderProfit({ status: "COMPLETED", items: [...order().items, ...order(null).items] }, income("100000")).quality, "MISSING_COST");
});
test("cancelled and unpaid orders are excluded and pending orders are estimated", () => {
  for (const status of ["CANCELLED", "IN_CANCEL", "UNPAID"]) assert.equal(calculateOrderProfit(order("1000", 1, status), income("10000")).quality, "EXCLUDED");
  assert.equal(calculateOrderProfit(order("1000", 1, "SHIPPED"), income("10000")).quality, "ESTIMATED");
  assert.equal(calculateOrderProfit(order("1000", 1, "COMPLETED", "CURRENT_ESTIMATE"), income("10000")).quality, "ESTIMATED");
});
test("mismatched orders and malformed financial snapshots are rejected", () => {
  assert.throws(() => normalizeSettlement({ order_sn: "other", order_income: { escrow_amount: 100 } }, "order1"), /MISMATCH/);
  assert.throws(() => income("10", { commission_fee: "bad" }));
  assert.equal(readSettlement({ payout: "1000" }), null);
  assert.deepEqual(readSettlement(income("1000")), income("1000"));
});
