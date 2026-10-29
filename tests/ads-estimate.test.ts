import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOutcomeCohorts, estimateAds, type EstimateOrder, type EstimateReport } from "../src/core/ads-estimate.ts";
const start = "2026-10-01T17:00:00.000Z"; // Oct 2 WIB
function order(id: string, revenue = "100", patch: Partial<EstimateOrder> = {}): EstimateOrder {
  return { id, createdAt: "2026-10-02T08:00:00Z", status: "COMPLETED", paymentStatus: "PAID",
    items: [{ itemId: "1", revenue }], returns: [], settlementRefund: null, ...patch };
}
function report(patch: Partial<EstimateReport> = {}): EstimateReport { return { start, spend: "100", revenue: "1000", ...patch }; }
function estimate(orders: EstimateOrder[], reports = [report()]) { return estimateAds(reports, buildOutcomeCohorts(orders), true, "PLACED_TOTAL"); }
test("ten original sales become eight on the original WIB date after two later cancellations", () => {
  const orders = Array.from({ length: 10 }, (_, index) => order(String(index)));
  assert.equal(estimate(orders).roas, "9.01");
  orders[0].status = "CANCELLED"; orders[1].status = "CANCELLED";
  const value = estimate(orders);
  assert.equal(value.roas, "7.21"); assert.equal(value.cancelledRevenue, "200.0000");
  assert.equal(buildOutcomeCohorts(orders).days.get("2026-10-02")!.retained, 8000000n);
  assert.equal(buildOutcomeCohorts(orders).days.has("2026-10-03"), false);
  assert.equal(value.revenue, "800.0000");
});
test("unpaid value is zero until confirmed payment and loss is revenue weighted", () => {
  const orders = [order("paid", "100"), order("unpaid", "900", { paymentStatus: "UNPAID", status: "UNPAID" })];
  assert.equal(estimate(orders).roas, "0.90");
  assert.equal(estimate(orders).unpaidRevenue, "900.0000");
  orders[1].paymentStatus = "PAID"; orders[1].status = "COMPLETED";
  assert.equal(estimate(orders).roas, "9.01");
  orders[1].status = "CANCELLED";
  assert.equal(estimate(orders).roas, "0.90");
});
test("accepted full and partial refunds reduce retained value once across cases, escrow and replay", () => {
  const orders = [order("a", "1000", { returns: [{ id: "r", status: "ACCEPTED", refund: "300" }], settlementRefund: "300" })];
  assert.equal(estimate(orders).roas, "6.31"); assert.equal(estimate(orders).refundedRevenue, "300.0000");
  assert.equal(estimate([...orders, ...orders]).roas, "6.31");
  orders[0].returns.push({ id: "r", status: "ACCEPTED", refund: "300" });
  assert.equal(estimate(orders).roas, "6.31");
  orders[0].status = "CANCELLED";
  assert.equal(estimate(orders).roas, "0.00"); assert.equal(estimate(orders).refundedRevenue, "0.0000");
});
test("multiple distinct partial cases sum, cumulative escrow is a floor, and excessive refund clamps to zero", () => {
  const value = order("a", "1000", { returns: [{ id: "a", status: "ACCEPTED", refund: "100" }, { id: "b", status: "ACCEPTED", refund: "200" }], settlementRefund: "400" });
  assert.equal(estimate([value]).roas, "5.41");
  value.settlementRefund = "1200";
  assert.equal(estimate([value]).roas, "0.00");
});
test("requested returns stay provisional and rejected or corrected returns restore the original cohort", () => {
  const value = order("a", "1000", { returns: [{ id: "a", status: "REQUESTED", refund: null }] });
  assert.equal(estimate([value]).roas, "9.01"); assert.equal(estimate([value]).pendingOrders, 1);
  value.returns[0] = { id: "a", status: "ACCEPTED", refund: "300" };
  assert.equal(estimate([value]).roas, "6.31");
  value.returns[0] = { id: "a", status: "REJECTED", refund: null };
  assert.equal(estimate([value]).roas, "9.01"); assert.equal(estimate([value]).pendingOrders, 0);
});
test("missing payment or confirmed refund amounts withhold an estimate instead of inventing zero loss", () => {
  for (const [patch, issue] of [
    [{ paymentStatus: "UNKNOWN" }, "PAYMENT_OUTCOME_UNKNOWN"],
    [{ returns: [{ id: "a", status: "ACCEPTED", refund: null }] }, "REFUND_AMOUNT_UNKNOWN"],
  ] as [Partial<EstimateOrder>, string][]) {
    const value = estimate([order("a", "1000", patch)]);
    assert.equal(value.roas, null); assert.ok(value.issues.includes(issue)); assert.equal(value.storeRevenue, null);
  }
  assert.equal(estimate([order("a", "1000", { paymentStatus: "UNKNOWN", status: "CANCELLED" })]).roas, "0.00");
});
test("product direct sales and shop halo use distinct revenue retention factors", () => {
  const orders = [order("product", "800", { items: [{ itemId: "1", revenue: "800" }], status: "CANCELLED" }),
    order("other", "200", { items: [{ itemId: "2", revenue: "200" }] })];
  const value = estimate(orders, [report({ sourceMetrics: { directRevenue: "600", advertisedItemIds: ["1"] } })]);
  assert.equal(value.revenue, "80.0000"); assert.equal(value.roas, "0.72");
  assert.equal(value.storeRevenue, "200.0000"); assert.equal(value.storeRoas, "1.80");
  assert.ok(!value.warnings.includes("SHOP_RETENTION_FALLBACK"));
  assert.equal(estimate(orders).roas, "1.80"); assert.ok(estimate(orders).warnings.includes("SHOP_RETENTION_FALLBACK"));
});
test("partial order-level refunds allocate proportionally across variants and products", () => {
  const orders = [order("a", "1000", { items: [{ itemId: "1", revenue: "300" }, { itemId: "1", revenue: "300" }, { itemId: "2", revenue: "400" }], returns: [{ id: "r", status: "ACCEPTED", refund: "250" }] })];
  const context = buildOutcomeCohorts(orders), product = context.days.get("2026-10-02")!.products.get("1")!;
  assert.equal(product.placed, 6000000n); assert.equal(product.retained, 4500000n);
  assert.equal(estimate(orders, [report({ sourceMetrics: { directRevenue: "1000", advertisedItemIds: ["1", "1"] } })]).roas, "6.76");
});
test("ratios use daily revenue and spend sums and retain arbitrary precision", () => {
  const orders = [order("day1", "1000", { status: "CANCELLED" }), order("day2", "9000", { createdAt: "2026-10-03T08:00:00Z" })];
  const value = estimate(orders, [report(), report({ start: "2026-10-02T17:00:00Z", spend: "900", revenue: "9000" })]);
  assert.equal(value.roas, "8.11"); assert.equal(value.revenue, "9000.0000");
  assert.equal(estimate([order("big", "9007199254740993.0001")], [report({ revenue: "9007199254740993.0001", spend: "1" })]).roas, "8114593923190083.78");
});
test("gaps, stale source issues, absent cohorts and confirmed basis never masquerade as adjusted totals", () => {
  const context = buildOutcomeCohorts([order("a", "1000")]);
  assert.equal(estimateAds([report()], context, false, "PLACED_TOTAL").roas, null);
  assert.equal(estimateAds([report()], context, true, "CONFIRMED_TOTAL").roas, null);
  assert.equal(estimateAds([report()], { ...context, issues: ["RETURN_SYNC_INCOMPLETE"] }, true, "PLACED_TOTAL").storeRevenue, null);
  assert.ok(estimate([]).issues.includes("NO_ORDER_COHORT"));
  assert.equal(estimate([order("a")], [report({ spend: "0" })]).roas, null);
  assert.equal(estimate([], [report({ revenue: "0" })]).roas, "0.00");
  assert.ok(estimate([order("a")], [report({ sourceMetrics: { directRevenue: "1001" } })]).issues.includes("INVALID_DIRECT_REVENUE"));
});
