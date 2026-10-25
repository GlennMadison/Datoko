import { amountString, amountUnits } from "./money.ts";
import { ratioString } from "./ads-roas.ts";
import { localDate } from "./reporting-period.ts";

export type EstimateOrder = {
  id: string; createdAt: string; status: string; paymentStatus: string;
  items: { itemId: string; revenue: string }[];
  returns: { id: string; status: string; refund: string | null }[];
  settlementRefund: string | null;
};
export type EstimateReport = {
  start: string; spend: string; revenue: string;
  sourceMetrics?: { directRevenue?: string; advertisedItemIds?: string[] };
};
export type OutcomeCohort = {
  placed: bigint; retained: bigint; count: number; unpaid: bigint; cancelled: bigint;
  refunded: bigint; pending: number; unknown: number; issues: string[];
  products: Map<string, { placed: bigint; retained: bigint }>;
};
export type EstimateContext = { days: Map<string, OutcomeCohort>; total: OutcomeCohort; issues: string[]; asOf: string | null };
export type AdsEstimate = {
  roas: string | null; revenue: string | null; excluded: string | null;
  storeRoas: string | null; storeRevenue: string | null; placedRevenue: string;
  unpaidRevenue: string; cancelledRevenue: string; refundedRevenue: string;
  orders: number; pendingOrders: number; unknownOrders: number; issues: string[]; warnings: string[]; asOf: string | null;
};
const empty = (): OutcomeCohort => ({ placed: 0n, retained: 0n, count: 0, unpaid: 0n, cancelled: 0n, refunded: 0n, pending: 0, unknown: 0, issues: [], products: new Map() });
const min = (a: bigint, b: bigint) => a < b ? a : b;
const roundedShare = (value: bigint, numerator: bigint, denominator: bigint) => denominator ? (value * numerator + denominator / 2n) / denominator : 0n;

/** Rebuild from current outcomes, attached to the original checkout date.
 * Refunds are cumulative evidence, never additive adjustments to prior runs.
 * Order-level refunds are distributed in proportion to immutable line revenue.
 */
export function buildOutcomeCohorts(orders: EstimateOrder[], issues: string[] = [], asOf: string | null = null): EstimateContext {
  const days = new Map<string, OutcomeCohort>(), total = empty();
  const seen = new Set<string>();
  for (const order of orders) {
    if (seen.has(order.id)) continue;
    seen.add(order.id);
    const lines = order.items.map(item => ({ ...item, amount: amountUnits(item.revenue) }));
    if (lines.some(line => line.amount < 0n)) throw new Error("INVALID_COHORT_REVENUE");
    const gross = lines.reduce((sum, line) => sum + line.amount, 0n);
    const cancelled = ["CANCELLED", "IN_CANCEL"].includes(order.status);
    const unpaid = order.status === "UNPAID" || order.paymentStatus === "UNPAID";
    const unknown = !cancelled && !unpaid && order.paymentStatus !== "PAID";
    const refunds = new Map<string, bigint>();
    let missingRefund = false, pending = !["CANCELLED", "COMPLETED", "UNPAID"].includes(order.status);
    for (const value of order.returns) {
      if (value.status === "ACCEPTED") {
        if (value.refund === null) missingRefund = true;
        else refunds.set(value.id, amountUnits(value.refund));
      } else if (!["CANCELLED", "CANCELED", "REJECTED", "CLOSED"].includes(value.status)) pending = true;
    }
    const caseRefund = [...refunds.values()].reduce((sum, value) => sum + value, 0n);
    const escrowRefund = order.settlementRefund === null ? 0n : amountUnits(order.settlementRefund);
    if (caseRefund < 0n || escrowRefund < 0n) throw new Error("INVALID_COHORT_REFUND");
    // Escrow and return cases can describe the same refund. Do not add them.
    const refund = min(gross, caseRefund > escrowRefund ? caseRefund : escrowRefund);
    const retained = cancelled || unpaid || unknown ? 0n : gross - refund;
    const orderIssues = [
      ...(unknown && gross ? ["PAYMENT_OUTCOME_UNKNOWN"] : []),
      ...(missingRefund && !cancelled && !unpaid && refund < gross ? ["REFUND_AMOUNT_UNKNOWN"] : []),
    ];
    const date = localDate(new Date(order.createdAt));
    const day = days.get(date) ?? empty(); days.set(date, day);
    for (const cohort of [day, total]) {
      cohort.placed += gross; cohort.retained += retained; cohort.count++;
      cohort.cancelled += cancelled ? gross : 0n;
      cohort.unpaid += !cancelled && unpaid ? gross : 0n;
      cohort.refunded += !cancelled && !unpaid && !unknown ? refund : 0n;
      cohort.pending += pending ? 1 : 0; cohort.unknown += unknown ? 1 : 0;
      cohort.issues.push(...orderIssues);
      // Aggregate by stable product ID before rounding, so variants share one allocation.
      const amounts = new Map<string, bigint>();
      for (const line of lines) amounts.set(line.itemId, (amounts.get(line.itemId) ?? 0n) + line.amount);
      for (const [id, amount] of amounts) {
        const previous = cohort.products.get(id) ?? { placed: 0n, retained: 0n };
        previous.placed += amount; previous.retained += roundedShare(retained, amount, gross);
        cohort.products.set(id, previous);
      }
    }
  }
  return { days, total, issues, asOf };
}

/** Placed totals only: applying this loss factor to confirmed sales would
 * double-remove unpaid orders. Calendar-date alignment and shared organic/ad
 * outcomes are assumptions, not order-level attribution.
 */
export function estimateAds(reports: EstimateReport[], context: EstimateContext, complete: boolean, basis: string): AdsEstimate {
  const issues = new Set(context.issues), warnings = new Set<string>(["CALENDAR_ALIGNMENT_ESTIMATE", "SHARED_OUTCOME_ASSUMPTION"]);
  if (!complete) issues.add("PERIOD_COVERAGE_INCOMPLETE");
  if (!reports.length) issues.add("NO_ADS_DATA");
  if (basis !== "PLACED_TOTAL" && basis !== "PLACED_DIRECT") issues.add("ESTIMATE_REQUIRES_PLACED_BASIS");
  let spend = 0n, revenue = 0n, original = 0n;
  for (const report of reports) {
    const broad = amountUnits(report.revenue); original += broad; spend += amountUnits(report.spend);
    if (!broad) continue;
    const cohort = context.days.get(localDate(new Date(report.start)));
    if (!cohort?.placed) { issues.add("NO_ORDER_COHORT"); continue; }
    cohort.issues.forEach(issue => issues.add(issue));
    if (cohort.count < 20) warnings.add("SMALL_COHORT");
    if (cohort.pending) warnings.add("PENDING_OUTCOMES");
    const metrics = report.sourceMetrics;
    const direct = basis === "PLACED_DIRECT" ? broad : metrics?.directRevenue === undefined ? null : amountUnits(metrics.directRevenue);
    if (direct !== null && (direct < 0n || direct > broad)) { issues.add("INVALID_DIRECT_REVENUE"); continue; }
    const ids = [...new Set(metrics?.advertisedItemIds ?? [])];
    const product = ids.reduce((sum, id) => {
      const value = cohort.products.get(id);
      return { placed: sum.placed + (value?.placed ?? 0n), retained: sum.retained + (value?.retained ?? 0n) };
    }, { placed: 0n, retained: 0n });
    if (direct !== null && ids.length && product.placed) {
      warnings.add("CURRENT_PRODUCT_MAPPING");
      revenue += roundedShare(direct, min(product.retained, product.placed), product.placed);
      revenue += roundedShare(broad - direct, cohort.retained, cohort.placed);
    } else {
      warnings.add("SHOP_RETENTION_FALLBACK");
      revenue += roundedShare(broad, cohort.retained, cohort.placed);
    }
  }
  const total = context.total;
  if (total.refunded) warnings.add("PROPORTIONAL_REFUND_ALLOCATION");
  if (total.pending) warnings.add("PENDING_OUTCOMES");
  const storeComplete = !context.issues.length && !total.issues.length;
  return {
    roas: issues.size ? null : ratioString(revenue, spend, 2), revenue: issues.size ? null : amountString(revenue),
    excluded: issues.size ? null : amountString(original - min(original, revenue)),
    storeRoas: storeComplete && complete ? ratioString(total.retained, spend, 2) : null,
    storeRevenue: storeComplete ? amountString(total.retained) : null, placedRevenue: amountString(total.placed),
    unpaidRevenue: amountString(total.unpaid), cancelledRevenue: amountString(total.cancelled), refundedRevenue: amountString(total.refunded),
    orders: total.count, pendingOrders: total.pending, unknownOrders: total.unknown,
    issues: [...issues], warnings: [...warnings], asOf: context.asOf,
  };
}
