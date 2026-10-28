import { amountString, amountUnits } from "../core/money.ts";
import { createTimeBuckets, periodContains, type ReportPeriod } from "../core/reporting-period.ts";
import { isOverviewOrder, isPaidSale, netOrderSales, type SalesOrder } from "../core/overview-sales.ts";

export type ActivityPoint = { key: string; date: string; sales: number | null; orders: number | null; units: number | null; refunds: number | null; profit: number | null; completedSales: number | null; completedOrders: number | null; completedUnits: number | null; completedProfit: number | null };
export function activityTrend(period: ReportPeriod, orders: (SalesOrder & { createdAt: string; quantity: number; profit?: string | number | null })[], returns: { updatedAt: string; confirmedRefund: string | null }[] = []): ActivityPoint[] {
  const buckets = createTimeBuckets(period);
  const totals = buckets.map(() => ({ sales: 0n, orders: 0, units: 0, refunds: 0n, profit: 0n, profitMissing: false, completedSales: 0n, completedOrders: 0, completedUnits: 0, completedProfit: 0n, completedProfitMissing: false }));
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
    if (index < 0 || !isOverviewOrder(order)) continue;
    const total = totals[index];
    total.orders++;
    if (!isPaidSale(order)) continue;
    const sales = amountUnits(netOrderSales(order));
    total.sales += sales;
    total.units += order.quantity;
    if (order.profit == null) total.profitMissing = true;
    else total.profit += amountUnits(order.profit);
    if (order.status === "COMPLETED") {
      total.completedSales += sales; total.completedOrders++; total.completedUnits += order.quantity;
      if (order.profit == null) total.completedProfitMissing = true;
      else total.completedProfit += amountUnits(order.profit);
    }
  }
  for (const value of returns) {
    const index = indexFor(value.updatedAt);
    if (index >= 0) totals[index].refunds += amountUnits(value.confirmedRefund ?? "0");
  }
  return buckets.map((bucket, index) => ({ key: bucket.key, date: bucket.date,
    sales: bucket.future ? null : Number(amountString(totals[index].sales)), orders: bucket.future ? null : totals[index].orders,
    profit: bucket.future || totals[index].profitMissing ? null : Number(amountString(totals[index].profit)),
    units: bucket.future ? null : totals[index].units, refunds: bucket.future ? null : Number(amountString(totals[index].refunds)),
    completedSales: bucket.future ? null : Number(amountString(totals[index].completedSales)),
    completedOrders: bucket.future ? null : totals[index].completedOrders,
    completedUnits: bucket.future ? null : totals[index].completedUnits,
    completedProfit: bucket.future || totals[index].completedProfitMissing ? null : Number(amountString(totals[index].completedProfit)),
  }));
}
