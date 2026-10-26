import { amountString, amountUnits } from "./money.ts";
import type { OrderProfit, Settlement } from "./profit.ts";

export const OTHER_SHOPEE_FEES = {
  seller_order_processing_fee: "Order processing fee",
  campaign_fee: "Campaign fee",
  escrow_tax: "Escrow tax",
  withholding_tax: "Withholding tax",
  fbs_fee: "Fulfilment fee",
  sales_tax_on_lvg: "Low-value goods sales tax",
  final_escrow_product_gst: "Product GST",
  vat_on_imported_goods: "Import VAT",
  withholding_vat_tax: "Withholding VAT",
  withholding_pit_tax: "Withholding personal income tax",
  withholding_cit_tax: "Withholding corporate income tax",
} as const;

export type CostItem = { key: string; label: string; amount: string };
export type CostSummary = {
  items: CostItem[]; sales: string; covered: number; eligible: number;
  estimated: number; groupedFees: number; profit: string | null;
};
type CostOrder = { status: string; merchandise: string; profit: OrderProfit; settlement: Settlement | null };

/** Use the same completed-order coverage as Overview profit. Revisions are resolved by the caller. */
export function summarizeOrderCosts(orders: CostOrder[]): CostSummary {
  const totals = new Map<string, { label: string; amount: bigint }>();
  let sales = 0n, profit = 0n, covered = 0, eligible = 0, estimated = 0, groupedFees = 0;
  function add(key: string, label: string, amount: string) {
    const previous = totals.get(key);
    totals.set(key, { label, amount: (previous?.amount ?? 0n) + amountUnits(amount) });
  }
  for (const order of orders) {
    if (order.status !== "COMPLETED") continue;
    eligible++;
    const settlement = order.settlement;
    if (!settlement || order.profit.profit === null || order.profit.cogs === null) continue;
    covered++;
    profit += amountUnits(order.profit.profit);
    if (order.profit.quality === "ESTIMATED") estimated++;
    sales += amountUnits(order.merchandise);
    add("cogs", "COGS", order.profit.cogs);
    add("commission", "Shopee commission", settlement.commission);
    add("service", "Shopee service fee", settlement.service);
    add("transaction", "Shopee transaction fee", settlement.transaction);
    add("affiliate", "Affiliate commission", settlement.affiliate);
    add("refunds", "Confirmed refunds", settlement.refunds);
    // Details replace the legacy other total; they must never be added to it.
    if (settlement.feeDetails) {
      for (const [key, label] of Object.entries(OTHER_SHOPEE_FEES)) add(key, label, settlement.feeDetails[key] ?? "0");
    } else {
      add("other", "Other Shopee fees", settlement.other);
      if (amountUnits(settlement.other) !== 0n) groupedFees++;
    }
  }
  return { items: [...totals].map(([key, item]) => ({ key, label: item.label, amount: amountString(item.amount) })), sales: amountString(sales), profit: covered || !eligible ? amountString(profit) : null, covered, eligible, estimated, groupedFees };
}

export function costBreakdown(summary: CostSummary, adSpend: string | null, adsComplete = true) {
  const items = [...summary.items, ...(adSpend === null ? [] : [{ key: "ads", label: "Advertisement", amount: adSpend }])];
  const costs = items.filter(item => amountUnits(item.amount) > 0n);
  const credits = items.filter(item => amountUnits(item.amount) < 0n);
  const sales = amountUnits(summary.sales);
  const cleanProfit = summary.profit !== null && adSpend !== null && adsComplete
    ? amountUnits(summary.profit) - amountUnits(adSpend) : null;
  // Payouts can include deductions or credits that the named fee fields do not itemize.
  // Reconcile to actual payout profit rather than estimating profit as sales minus known fees.
  const recordedCosts = costs.reduce((sum, item) => sum + amountUnits(item.amount), 0n);
  const difference = cleanProfit === null ? 0n : sales - recordedCosts - cleanProfit;
  if (difference > 0n) costs.push({ key: "other_deductions", label: "Other deductions", amount: amountString(difference) });
  const total = costs.reduce((sum, item) => sum + amountUnits(item.amount), 0n);
  const pieces = [...costs];
  if (cleanProfit !== null && cleanProfit >= 0n && summary.covered > 0) pieces.push({ key: "profit", label: "Clean profit", amount: amountString(cleanProfit) });
  const chartTotal = total + (cleanProfit !== null && cleanProfit > 0n ? cleanProfit : 0n);
  function percent(amount: bigint, denominator: bigint): number | null {
    if (denominator <= 0n) return null;
    const absolute = amount < 0n ? -amount : amount;
    return Number((absolute * 10_000n + denominator / 2n) / denominator) / 100 * (amount < 0n ? -1 : 1);
  }
  return {
    total: amountString(total), chartTotal: amountString(chartTotal), salesPercentage: percent(total, sales), credits,
    cleanProfit: cleanProfit === null ? null : amountString(cleanProfit), profitPercentage: cleanProfit === null ? null : percent(cleanProfit, sales),
    otherIncome: amountString(difference < 0n ? -difference : 0n),
    slices: pieces.map(item => ({ ...item, value: Number(item.amount), percentage: percent(amountUnits(item.amount), chartTotal) ?? 0, salesPercentage: percent(amountUnits(item.amount), sales) })),
  };
}