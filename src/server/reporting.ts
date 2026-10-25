import { amountString, amountUnits } from "../core/money.ts";
import { createTimeBuckets, periodContains, type ReportPeriod } from "../core/reporting-period.ts";

export type ActivityPoint = { key: string; date: string; sales: number | null; orders: number | null; units: number | null; refunds: number | null; profit: number | null };
export function activityTrend(period: ReportPeriod, orders: { createdAt: string; status: string; merchandise: string; quantity: number; profit?: string | number | null }[], returns: { updatedAt: string; confirmedRefund: string | null }[] = []): ActivityPoint[] {
  const buckets = createTimeBuckets(period);
  const totals = buckets.map(() => ({ sales: 0n, orders: 0, units: 0, refunds: 0n, profit: 0n, profitMissing: false }));
  const starts = buckets.map(bucket => Date.parse(bucket.start));
  function indexFor(date: string): number {
    if (!periodContains(period, date)) return -1;
    const time = Date.parse(date);
    let low = 0, high = starts.length;
    while (low < high) { const mid = Math.floor((low + high) / 2); if (starts[mid] <= time) low = mid + 1; else high = mid; }
    return low - 1;
  }
  for (const order of orders) {
    const index = indexFor(order.createdAt);
    if (index < 0) continue;
    totals[index].orders++;
    if (order.status === "COMPLETED") { totals[index].sales += amountUnits(order.merchandise); if (order.profit == null) totals[index].profitMissing = true; else totals[index].profit += amountUnits(order.profit); totals[index].units += order.quantity; }
  }
  for (const value of returns) {
    const index = indexFor(value.updatedAt);
    if (index >= 0) totals[index].refunds += amountUnits(value.confirmedRefund ?? "0");
  }
  return buckets.map((bucket, index) => ({ key: bucket.key, date: bucket.date,
    sales: bucket.future ? null : Number(amountString(totals[index].sales)), orders: bucket.future ? null : totals[index].orders,
    profit: bucket.future || totals[index].profitMissing ? null : Number(amountString(totals[index].profit)),
    units: bucket.future ? null : totals[index].units, refunds: bucket.future ? null : Number(amountString(totals[index].refunds)),
  }));
}
