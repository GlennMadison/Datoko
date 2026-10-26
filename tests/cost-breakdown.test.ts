import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeOrderCosts, costBreakdown } from "../src/core/cost-breakdown.ts";
import { normalizeSettlement, calculateOrderProfit, readSettlement, type Settlement } from "../src/core/profit.ts";

function fixture(extra: Record<string, unknown> = {}, cost: string | null = "10000", status = "COMPLETED") {
  const settlement = normalizeSettlement({ order_sn: "order1", order_income: {
    escrow_amount: "82000", escrow_amount_after_adjustment: "77000", commission_fee: "6000",
    service_fee: "4000", seller_transaction_fee: "2000", order_ams_commission_fee: "3000",
    seller_order_processing_fee: "1250", campaign_fee: "750", withholding_tax: "1000", seller_return_refund: "-5000", ...extra,
  } }, "order1");
  const profit = calculateOrderProfit({ status, items: [{ quantity: 2, costSnapshot: cost }] }, settlement);
  return { status, merchandise: "100000", profit, settlement };
}

test("each Shopee fee, affiliate, COGS, refunds and shop advertising have separate non-overlapping shares", () => {
  const summary = summarizeOrderCosts([fixture()]);
  const result = costBreakdown(summary, "7000");
  assert.equal(result.total, "50000.0000");
  assert.equal(result.salesPercentage, 50);
  assert.equal(result.slices.find(item => item.key === "cogs")?.amount, "20000.0000");
  assert.equal(result.slices.find(item => item.key === "ads")?.percentage, 7);
  assert.equal(result.slices.find(item => item.key === "ads")?.salesPercentage, 7);
  assert.equal(result.slices.find(item => item.key === "seller_order_processing_fee")?.amount, "1250.0000");
  assert.equal(result.slices.find(item => item.key === "campaign_fee")?.amount, "750.0000");
  assert.equal(result.slices.find(item => item.key === "withholding_tax")?.amount, "1000.0000");
  assert.equal(result.slices.some(item => item.key === "other" || item.key === "adjustment"), false);
  assert.equal(result.slices.reduce((sum, item) => sum + item.percentage, 0), 100);
  assert.equal(summary.covered, 1);
});

test("older aggregate fee snapshots remain readable and are not presented as invented individual fees", () => {
  const order = fixture();
  const { feeDetails, ...legacy } = order.settlement;
  assert.ok(feeDetails);
  const summary = summarizeOrderCosts([{ ...order, settlement: readSettlement(legacy)! }]);
  assert.equal(summary.groupedFees, 1);
  const result = costBreakdown(summary, "7000");
  assert.equal(result.total, "50000.0000");
  assert.equal(result.slices.find(item => item.key === "other")?.amount, "3000.0000");
  assert.equal(result.slices.some(item => item.key === "campaign_fee"), false);
});

test("missing payouts and costs cannot dilute coverage or create fabricated percentages", () => {
  const unpaid = fixture({}, "10000", "UNPAID");
  const missing = fixture({}, null);
  const pending = fixture({}, "10000", "SHIPPED");
  const order = fixture();
  const summary = summarizeOrderCosts([order, unpaid, missing, pending, { ...order, settlement: null }]);
  assert.equal(summary.covered, 1);
  assert.equal(summary.eligible, 3);
  assert.equal(summary.sales, "100000.0000");
  assert.equal(costBreakdown(summary, "7000").total, "50000.0000");
  const noOrders = costBreakdown(summarizeOrderCosts([]), "7000");
  assert.equal(noOrders.slices[0].percentage, 100);
  assert.equal(noOrders.salesPercentage, null);
});

test("zero costs and missing ad data do not produce NaN or imply known advertising spend", () => {
  const summary = summarizeOrderCosts([]);
  for (const spend of [null, "0"]) {
    const result = costBreakdown(summary, spend);
    assert.equal(result.total, "0.0000");
    assert.equal(result.salesPercentage, null);
    assert.deepEqual(result.slices, []);
  }
});

test("credits remain separate from positive pie slices and zero-valued fees are hidden", () => {
  const order = fixture({ service_fee: "-4000", campaign_fee: "0", escrow_amount_after_adjustment: "85750" });
  const result = costBreakdown(summarizeOrderCosts([order]), "0");
  assert.equal(result.credits.find(item => item.key === "service")?.amount, "-4000.0000");
  assert.equal(result.slices.some(item => ["service", "campaign_fee", "ads"].includes(item.key)), false);
  assert.ok(result.slices.every(item => item.value > 0));
});

test("fee details are exact, validated against their aggregate, and do not change payout profit", () => {
  const order = fixture({ seller_order_processing_fee: "1250.1234", campaign_fee: "0.0001" });
  assert.equal(order.settlement.feeDetails!.seller_order_processing_fee, "1250.1234");
  assert.equal(order.settlement.other, "2250.1235");
  assert.deepEqual(readSettlement(order.settlement), order.settlement);
  assert.equal(order.profit.profit, "57000.0000");
  for (const details of [{ campaign_fee: "1" }, { campaign_fee: "invalid" }, { untrusted: "0" }, []]) {
    assert.equal(readSettlement({ ...order.settlement, feeDetails: details }), null);
  }
  const withoutDetails: Settlement = { ...order.settlement };
  delete withoutDetails.feeDetails;
  assert.equal(readSettlement(withoutDetails)?.payout, "77000.0000");
});

test("clean profit uses the same settled payout minus COGS and ads as Overview", () => {
  const summary = summarizeOrderCosts([fixture()]);
  const result = costBreakdown(summary, "7000");
  assert.equal(summary.profit, "57000.0000");
  assert.equal(result.cleanProfit, "50000.0000");
  assert.equal(result.profitPercentage, 50);
  assert.equal(result.chartTotal, "100000.0000");
  assert.equal(result.slices.find(item => item.key === "profit")?.percentage, 50);
});

test("unitemized payout deductions reconcile the pie without inflating clean profit", () => {
  const result = costBreakdown(summarizeOrderCosts([fixture({ escrow_amount_after_adjustment: "65000" })]), "7000");
  assert.equal(result.cleanProfit, "38000.0000");
  assert.equal(result.profitPercentage, 38);
  assert.equal(result.slices.find(item => item.key === "other_deductions")?.amount, "12000.0000");
  assert.equal(result.slices.find(item => item.key === "profit")?.percentage, 38);
  assert.equal(result.total, "62000.0000");
  assert.equal(result.chartTotal, "100000.0000");
});

test("payout credits preserve actual profit and clearly distinguish sales margin from pie share", () => {
  const result = costBreakdown(summarizeOrderCosts([fixture({ escrow_amount_after_adjustment: "87000" })]), "7000");
  assert.equal(result.cleanProfit, "60000.0000");
  assert.equal(result.profitPercentage, 60);
  assert.equal(result.otherIncome, "10000.0000");
  assert.equal(result.chartTotal, "110000.0000");
  assert.equal(result.slices.find(item => item.key === "profit")?.percentage, 54.55);
});

test("losses and zero profit never become positive pie slices", () => {
  const summary = summarizeOrderCosts([fixture()]);
  const loss = costBreakdown(summary, "70000");
  assert.equal(loss.cleanProfit, "-13000.0000");
  assert.equal(loss.profitPercentage, -13);
  assert.equal(loss.slices.some(item => item.key === "profit"), false);
  assert.ok(loss.slices.every(item => item.value > 0));
  const zero = costBreakdown(summary, "57000");
  assert.equal(zero.cleanProfit, "0.0000");
  assert.equal(zero.slices.find(item => item.key === "profit")?.percentage, 0);
});

test("incomplete ad coverage and missing order costs withhold profit rather than overstate it", () => {
  const summary = summarizeOrderCosts([fixture()]);
  for (const result of [costBreakdown(summary, null), costBreakdown(summary, "1000", false), costBreakdown(summarizeOrderCosts([fixture({}, null)]), "1000")]) {
    assert.equal(result.cleanProfit, null);
    assert.equal(result.profitPercentage, null);
    assert.equal(result.slices.some(item => item.key === "profit"), false);
  }
});