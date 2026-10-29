import { amountString, amountUnits } from "./money.ts";
import { advertisingCost } from "./ads-cost.ts";

type ProfitItem = { itemId: string; quantity: number; paidUnitPrice: string; costSnapshot: string | null };
type ProfitOrder = { status: string; payout: string | null; items: ProfitItem[] };
export type ProductProfitBase = { products: { itemId: string; profit: string }[]; covered: number; eligible: number; mixedOrders: number };
export type ProductAdSpend = { products: { itemId: string; spend: string }[]; totalSpend: string; unassignedSpend: string };
type AdBucket = { campaignKey: string; grain: "DAY" | "HOUR"; start: string; spend: string; sourceMetrics?: { advertisedItemIds?: string[] } };

/** Split the order payout by paid merchandise value, then subtract each item's own COGS.
 * Payout/refund allocation is estimated for mixed-product orders. Integer remainders
 * stay with the final item so product profits reconcile to the order exactly.
 */
export function summarizeProductProfit(orders: ProfitOrder[]): ProductProfitBase {
  const totals = new Map<string, bigint>();
  let covered = 0, eligible = 0, mixedOrders = 0;
  for (const order of orders) {
    if (order.status !== "COMPLETED") continue;
    eligible++;
    if (order.payout === null || !order.items.length || order.items.some(item => item.costSnapshot === null)) continue;
    covered++;
    if (new Set(order.items.map(item => item.itemId)).size > 1) mixedOrders++;
    const revenue = order.items.map(item => amountUnits(item.paidUnitPrice) * BigInt(item.quantity));
    const revenueTotal = revenue.reduce((sum, value) => sum + value, 0n);
    const weights = revenueTotal > 0n ? revenue : order.items.map(item => BigInt(item.quantity));
    const weightTotal = weights.reduce((sum, value) => sum + value, 0n);
    const payout = amountUnits(order.payout);
    let allocated = 0n;
    order.items.forEach((item, index) => {
      const share = index === order.items.length - 1 ? payout - allocated : payout * weights[index] / weightTotal;
      allocated += share;
      const profit = share - amountUnits(item.costSnapshot!) * BigInt(item.quantity);
      totals.set(item.itemId, (totals.get(item.itemId) ?? 0n) + profit);
    });
  }
  return { products: [...totals].map(([itemId, profit]) => ({ itemId, profit: amountString(profit) })), covered, eligible, mixedOrders };
}

/** Shop/campaign and daily/hourly reports overlap; never add overlapping expenses.
 * Only single-product campaigns identify actual product spend. Unmapped/shared
 * campaigns and conflicting day totals stay unassigned, preserving organic profit.
 */
export function allocateProductAds(shopRows: AdBucket[], campaignRows: AdBucket[]): ProductAdSpend {
  const dayKey = (start: string) => new Date(Date.parse(start) + 7 * 3_600_000).toISOString().slice(0, 10);
  const shopDays = new Map<string, bigint>();
  for (const row of shopRows) {
    const day = dayKey(row.start);
    shopDays.set(day, (shopDays.get(day) ?? 0n) + amountUnits(row.spend));
  }
  const products = new Map<string, bigint>();
  let totalSpend = 0n, assigned = 0n;
  for (const [day, shopSpend] of shopDays) {
    totalSpend += shopSpend;
    const campaigns = new Map<string, AdBucket[]>();
    for (const row of campaignRows) {
      if (row.campaignKey === "shop" || dayKey(row.start) !== day) continue;
      campaigns.set(row.campaignKey, [...(campaigns.get(row.campaignKey) ?? []), row]);
    }
    const selected = [...campaigns.values()].flatMap(rows => rows.some(row => row.grain === "DAY") ? rows.filter(row => row.grain === "DAY") : rows);
    if (selected.reduce((sum, row) => sum + amountUnits(row.spend), 0n) > shopSpend) continue;
    for (const row of selected) {
      const ids = [...new Set(row.sourceMetrics?.advertisedItemIds ?? [])];
      if (ids.length !== 1) continue;
      const spend = amountUnits(row.spend);
      products.set(ids[0], (products.get(ids[0]) ?? 0n) + spend);
      assigned += spend;
    }
  }
  return { products: [...products].map(([itemId, spend]) => ({ itemId, spend: amountString(spend) })), totalSpend: amountString(totalSpend), unassignedSpend: amountString(totalSpend - assigned) };
}

export function productProfitContributions(base: ProductProfitBase, ads: ProductAdSpend, names: { sourceItemId: string; name: string }[]) {
  const profits = new Map(base.products.map(row => [row.itemId, amountUnits(row.profit)]));
  const spend = new Map<string, bigint>();
  let assignedBase = 0n, assignedCost = 0n;
  // Cumulative rounding keeps product and unassigned costs equal to the shop
  // expense, even when individual PPN amounts round at the ledger precision.
  for (const row of ads.products) {
    assignedBase += amountUnits(row.spend);
    const cumulativeCost = amountUnits(advertisingCost(amountString(assignedBase)).total);
    spend.set(row.itemId, (spend.get(row.itemId) ?? 0n) + cumulativeCost - assignedCost);
    assignedCost = cumulativeCost;
  }
  const unassignedSpend = amountString(amountUnits(advertisingCost(ads.totalSpend).total) - assignedCost);
  const titles = new Map(names.map(row => [row.sourceItemId, row.name]));
  const ids = [...new Set([...profits.keys(), ...spend.keys()])];
  const products = ids.map(itemId => {
    const gross = profits.get(itemId) ?? 0n, advertising = spend.get(itemId) ?? 0n;
    return { itemId, name: titles.get(itemId) ?? `Product ${itemId}`, profitBeforeAds: amountString(gross), adSpend: amountString(advertising), cleanProfit: amountString(gross - advertising) };
  }).sort((a, b) => Number(b.cleanProfit) - Number(a.cleanProfit) || a.itemId.localeCompare(b.itemId));
  const positiveTotal = products.reduce((sum, row) => sum + (amountUnits(row.cleanProfit) > 0n ? amountUnits(row.cleanProfit) : 0n), 0n);
  const total = products.reduce((sum, row) => sum + amountUnits(row.cleanProfit), -amountUnits(unassignedSpend));
  return {
    products: products.map(row => ({ ...row, percentage: amountUnits(row.cleanProfit) > 0n && positiveTotal > 0n ? Number(amountUnits(row.cleanProfit) * 10_000n / positiveTotal) / 100 : null })),
    total: amountString(total), positiveTotal: amountString(positiveTotal), unassignedSpend,
    hasLosses: products.some(row => amountUnits(row.cleanProfit) < 0n),
    partial: base.covered < base.eligible, mixedOrders: base.mixedOrders,
  };
}
