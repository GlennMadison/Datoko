import { amountString, amountUnits } from "./money.ts";
import { AppError } from "./errors.ts";

export type AdAllocation = {
  key: string; orderSn: string; lineKey: string; amount: string;
  disposition: "RETAINED" | "CANCELLED" | "RETURNED"; confirmedRefund: string;
  provisional: boolean; returnReferences: string[];
};
export type AdSourceReport = {
  key: string; start: string; end: string; grain: "DAY" | "HOUR";
  spend: string; revenue: string; sourceAsOf: string;
  attributionComplete: boolean; outcomesComplete: boolean; allocations: AdAllocation[];
};
export type AttributionEvidence = {
  lineRevenue: string; orderStatus: string; updatedAt: string; paymentStatus?: string;
  name?: string; sku?: string | null;
  creditedByScope?: Map<string, bigint>;
  orderBuyerTotal?: string;
  returns: { reference: string; updatedAt: string; confirmedRefund?: string | null }[];
};
export const attributionLineKey = (orderSn: string, lineKey: string) => JSON.stringify([orderSn, lineKey]);
export type RoasResult = {
  spend: string; originalRevenue: string; retainedRevenue: string | null; excludedRevenue: string | null;
  originalRoas: string | null; realRoas: string | null;
  matchedRevenue: string; coveragePercent: string; allocations: number; issues: string[];
  provisional: boolean; asOf: string | null;
  lines: { key: string; orderSn: string; lineKey: string; name: string | null; sku: string | null; credited: string; retained: string | null; excluded: string | null; outcome: string; matched: boolean }[];
};

/** Round once at the presentation boundary. All sums and divisions use bigint. */
export function ratioString(numerator: bigint, denominator: bigint, places = 4): string | null {
  if (numerator < 0n || denominator < 0n || !Number.isInteger(places) || places < 0 || places > 6) throw new AppError("INVALID_ROAS_INPUT");
  if (denominator === 0n) return null;
  const scale = 10n ** BigInt(places);
  const rounded = (numerator * scale + denominator / 2n) / denominator;
  return places ? `${rounded / scale}.${String(rounded % scale).padStart(places, "0")}` : String(rounded);
}
function nonnegative(value: string): bigint {
  const result = amountUnits(value);
  if (result < 0n) throw new AppError("NEGATIVE_ADS_AMOUNT");
  return result;
}

/**
 * Allocations are disjoint credited revenue entitlements (split partial units).
 * A cancelled/returned entitlement has zero retained revenue, regardless of a
 * later refund. Refunds affect only entitlements otherwise retained.
 * Source totals, matching, and outcome freshness gate the entire result.
 */
export function calculateRoas(reports: AdSourceReport[], evidence: Map<string, AttributionEvidence> = new Map(), options: { requireEvidence?: boolean; now?: Date; scopeKey?: string } = {}): RoasResult {
  const issues = new Set<string>();
  const seen = new Set<string>();
  const claims = new Map<string, bigint>();
  const orderOutcomes = new Map<string, { total: bigint; credited: bigint; retained: bigint; refunds: Map<string, bigint> }>();
  const lines: RoasResult["lines"] = [];
  let spend = 0n, revenue = 0n, retained = 0n, matchedRevenue = 0n, provisional = false;
  let asOf: string | null = null;
  if (!reports.length) issues.add("NO_ADS_DATA");
  const ordered = [...reports].sort((a, b) => a.start.localeCompare(b.start));
  for (let index = 0; index < ordered.length; index++) {
    const report = ordered[index];
    if (!Number.isFinite(Date.parse(report.start)) || !Number.isFinite(Date.parse(report.end)) || Date.parse(report.start) >= Date.parse(report.end) || !Number.isFinite(Date.parse(report.sourceAsOf))) throw new AppError("INVALID_ADS_PERIOD");
    if (index && Date.parse(ordered[index - 1].end) > Date.parse(report.start)) throw new AppError("OVERLAPPING_ADS_REPORTS");
    spend += nonnegative(report.spend);
    const sourceRevenue = nonnegative(report.revenue);
    revenue += sourceRevenue;
    let credited = 0n;
    if (!report.attributionComplete) issues.add("ATTRIBUTION_INCOMPLETE");
    if (!report.outcomesComplete) issues.add("OUTCOME_COVERAGE_INCOMPLETE");
    if (!asOf || report.sourceAsOf < asOf) asOf = report.sourceAsOf;
    if (Date.parse(report.end) > (options.now ?? new Date()).getTime()) provisional = true;
    for (const allocation of report.allocations) {
      if (seen.has(allocation.key)) issues.add("DUPLICATE_ATTRIBUTION");
      seen.add(allocation.key);
      const amount = nonnegative(allocation.amount);
      const refund = nonnegative(allocation.confirmedRefund);
      if (refund > amount || !["RETAINED", "CANCELLED", "RETURNED"].includes(allocation.disposition)) throw new AppError("INVALID_ADS_OUTCOME");
      credited += amount;
      const key = attributionLineKey(allocation.orderSn, allocation.lineKey);
      const known = evidence.get(key);
      const matched = !options.requireEvidence || Boolean(known);
      if (!matched) issues.add("UNMATCHED_ATTRIBUTION");
      else matchedRevenue += amount;
      if (known) {
        claims.set(key, (claims.get(key) ?? 0n) + amount);
        if (!["CANCELLED", "IN_CANCEL", "UNPAID"].includes(known.orderStatus) && known.paymentStatus !== "UNPAID" && Date.parse(known.updatedAt) > Date.parse(report.sourceAsOf)) issues.add("OUTCOMES_OUTDATED");
        if (known.returns.some(value => !allocation.returnReferences.includes(value.reference) || Date.parse(value.updatedAt) > Date.parse(report.sourceAsOf))) issues.add("RETURN_COVERAGE_INCOMPLETE");
      }
      if (known?.paymentStatus === "UNKNOWN" && !["CANCELLED", "IN_CANCEL", "UNPAID"].includes(known.orderStatus)) issues.add("PAYMENT_OUTCOME_UNKNOWN");
      const outcome = known && ["CANCELLED", "IN_CANCEL"].includes(known.orderStatus) ? "CANCELLED"
        : known && (known.orderStatus === "UNPAID" || known.paymentStatus === "UNPAID") ? "UNPAID" : allocation.disposition;
      const eligible = outcome === "RETAINED" ? amount - refund : 0n;
      retained += eligible;
      if (known?.orderBuyerTotal !== undefined) {
        let order = orderOutcomes.get(allocation.orderSn);
        if (!order) { order = { total: nonnegative(known.orderBuyerTotal), credited: 0n, retained: 0n, refunds: new Map() }; orderOutcomes.set(allocation.orderSn, order); }
        order.credited += amount; order.retained += eligible;
        for (const value of known.returns) if (value.confirmedRefund !== undefined && value.confirmedRefund !== null) order.refunds.set(value.reference, nonnegative(value.confirmedRefund));
      }
      provisional ||= allocation.provisional || Boolean(known && !["COMPLETED", "CANCELLED"].includes(known.orderStatus));
      lines.push({ key: allocation.key, orderSn: allocation.orderSn, lineKey: allocation.lineKey, name: known?.name ?? null, sku: known?.sku ?? null, credited: amountString(amount), retained: matched ? amountString(eligible) : null, excluded: matched ? amountString(amount - eligible) : null, outcome, matched });
    }
    if (credited !== sourceRevenue) issues.add("ATTRIBUTION_TOTAL_MISMATCH");
  }
  for (const [key, total] of claims) {
    const known = evidence.get(key)!;
    const scopeCredit = options.scopeKey ? known.creditedByScope?.get(options.scopeKey) : undefined;
    if ((scopeCredit ?? total) > nonnegative(known.lineRevenue)) issues.add("CREDIT_EXCEEDS_ORDER_LINE");
  }
  for (const order of orderOutcomes.values()) {
    const confirmed = [...order.refunds.values()].reduce((sum, value) => sum + value, 0n);
    // Refunds can concern shipping, organic items, or credits outside the
    // selected period. Only reject a contradiction; never assign those losses
    // to advertising without explicit source attribution.
    const outsideCredit = order.total > order.credited ? order.total - order.credited : 0n;
    const minimumLoss = confirmed > outsideCredit ? confirmed - outsideCredit : 0n;
    if (order.credited - order.retained < minimumLoss) issues.add("OUTCOME_TOTAL_MISMATCH");
  }
  const complete = issues.size === 0;
  // Unknown coverage never becomes an exact adjusted total or subset ratio.
  return {
    spend: amountString(spend), originalRevenue: amountString(revenue),
    retainedRevenue: complete ? amountString(retained) : null,
    excludedRevenue: complete ? amountString(revenue - retained) : null,
    originalRoas: ratioString(revenue, spend, 2), realRoas: complete ? ratioString(retained, spend, 2) : null,
    matchedRevenue: amountString(matchedRevenue), coveragePercent: revenue ? ratioString(matchedRevenue * 100n, revenue, 1)! : complete ? "100.0" : "0.0",
    allocations: lines.length, issues: [...issues], provisional, asOf,
    lines: lines.map(line => complete ? line : { ...line, retained: null, excluded: null }),
  };
}
