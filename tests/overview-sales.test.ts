import { test } from "node:test";
import assert from "node:assert/strict";
import { isOverviewOrder, isPaidSale, netOrderSales } from "../src/core/overview-sales.ts";
import { orderStatusSummary } from "../src/core/order-status.ts";
import { cancellationBreakdown, cancellationDetails } from "../src/core/cancellations.ts";
import { activityTrend } from "../src/server/reporting.ts";
import { resolveReportPeriod } from "../src/core/reporting-period.ts";

const period = resolveReportPeriod({ preset: "custom", from: "2026-10-01", to: "2026-10-03", interval: "day" }, new Date("2026-10-04T12:00:00Z"));
const order = (status: string, extra = {}) => ({ createdAt: "2026-10-01T03:00:00Z", status, merchandise: "100000", quantity: 2, profit: "30000", ...extra });

test("sales includes paid orders in every fulfilment stage on their original date", () => {
  const rows = ["READY_TO_SHIP", "PROCESSED", "SHIPPED", "TO_CONFIRM_RECEIVE", "COMPLETED"].map(status => order(status));
  const points = activityTrend(period, rows);
  assert.equal(points[0].sales, 500000);
  assert.equal(points[0].completedSales, 100000);
  assert.equal(points[0].units, 10);
  assert.equal(points[0].completedUnits, 2);
  assert.equal(points[0].profit, 150000);
  assert.equal(points[0].completedProfit, 30000);
  assert.equal(points[1].sales, 0);
});

test("unpaid is absent from overview counts and chart, then enters once paid", () => {
  for (const row of [order("UNPAID", { paymentStatus: "PAID" }), order("PROCESSED", { paymentStatus: "UNPAID" })]) {
    assert.equal(isOverviewOrder(row), false);
    const point = activityTrend(period, [row])[0];
    assert.deepEqual([point.orders, point.sales, point.units, point.profit], [0, 0, 0, 0]);
  }
  const paid = order("READY_TO_SHIP", { paymentStatus: "PAID" });
  assert.equal(activityTrend(period, [paid])[0].sales, 100000);
  assert.equal(orderStatusSummary([paid]).inProgress, 1);
});

test("cancelled unpaid history remains in status totals but never contributes sales", () => {
  const row = order("CANCELLED", { paymentStatus: "UNPAID" });
  assert.equal(isOverviewOrder(row), true);
  assert.equal(isPaidSale(row), false);
  assert.equal(activityTrend(period, [row])[0].orders, 1);
  assert.equal(activityTrend(period, [row])[0].sales, 0);
  assert.equal(netOrderSales(order("IN_CANCEL", { paymentStatus: "PAID" })), "0.0000");
  assert.equal(netOrderSales(order("UNKNOWN")), "0.0000");
});

test("completion moves the completed subset without adding a second sale", () => {
  const pending = activityTrend(period, [order("SHIPPED")])[0];
  const completed = activityTrend(period, [order("COMPLETED")])[0];
  assert.equal(pending.sales, completed.sales);
  assert.equal(pending.completedSales, 0);
  assert.equal(completed.completedSales, 100000);
  assert.equal(completed.orders, 1);
});

test("confirmed refunds restate the original order even when the refund happened outside the period", () => {
  const row = order("COMPLETED", { settlementRefund: "30000", returns: [
    { id: "r1", status: "ACCEPTED", confirmedRefund: "20000" },
    { id: "r2", status: "ACCEPTED", confirmedRefund: "10000" },
    { id: "r1", status: "ACCEPTED", confirmedRefund: "20000" },
    { id: "r3", status: "REQUESTED", confirmedRefund: "50000" },
  ] });
  const points = activityTrend(period, [row], [{ updatedAt: "2026-10-10T00:00:00Z", confirmedRefund: "30000" }]);
  assert.equal(points[0].sales, 70000);
  assert.equal(points[0].completedSales, 70000);
  assert.equal(points[0].refunds, 0);
  assert.equal(netOrderSales({ ...row, settlementRefund: "40000" }), "60000.0000");
  assert.equal(netOrderSales({ ...row, settlementRefund: "200000" }), "0.0000");
});

test("pending or rejected refunds do not reduce sales and decimals remain exact", () => {
  const row = order("COMPLETED", { merchandise: "0.3", returns: [{ id: "r1", status: "REJECTED", confirmedRefund: "0.2" }] });
  assert.equal(netOrderSales(row), "0.3000");
  assert.equal(netOrderSales({ ...row, settlementRefund: "0.2" }), "0.1000");
});

test("missing ongoing payouts leave a profit gap without hiding completed profit", () => {
  const point = activityTrend(period, [order("COMPLETED"), order("PROCESSED", { profit: null })])[0];
  assert.equal(point.profit, null);
  assert.equal(point.completedProfit, 30000);
  assert.equal(point.sales, 200000);
});

test("in-progress subrows reconcile and exclude unpaid orders", () => {
  const summary = orderStatusSummary(["UNPAID", "COMPLETED", "CANCELLED", "READY_TO_SHIP", "PROCESSED", "SHIPPED", "TO_CONFIRM_RECEIVE", "IN_CANCEL", "TO_RETURN"].map(status => ({ status })));
  assert.equal(summary.total, 8);
  assert.equal(summary.inProgress, 6);
  assert.equal(summary.details.reduce((sum, value) => sum + value.count, 0), summary.inProgress);
  assert.equal(orderStatusSummary([{ status: "UNPAID" }]).total, 0);
});

test("cancelled subrows are exclusive, include unknown payment, and reconcile", () => {
  const rows = [
    { status: "CANCELLED", paymentStatus: "PAID", returns: [] },
    { status: "CANCELLED", paymentStatus: "UNPAID", returns: [] },
    { status: "CANCELLED", paymentStatus: "PAID", returns: [{ status: "ACCEPTED" }] },
    { status: "CANCELLED", paymentStatus: "UNKNOWN", returns: [{ status: "REJECTED" }] },
    { status: "SHIPPED", paymentStatus: "PAID", returns: [] },
  ];
  const result = cancellationBreakdown(rows);
  assert.deepEqual(result, { all: 4, paid: 1, unpaid: 1, returned: 1, unknown: 1 });
  const details = cancellationDetails(result);
  assert.equal(details.reduce((sum, value) => sum + value.count, 0), result.all);
  assert.deepEqual(details.map(value => value.label), ["Before payment", "After payment", "Returned", "Payment unconfirmed"]);
  assert.equal(cancellationDetails(cancellationBreakdown([])).length, 3);
});
