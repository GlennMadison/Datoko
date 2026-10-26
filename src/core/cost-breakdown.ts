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
  estimated: number; groupedFees: number;
};
type CostOrder = { status: string; merchandise: string; profit: OrderProfit; settlement: Settlement | null };

/** Use the same completed-order coverage as Overview profit. Revisions are resolved by the caller. */
export function summarizeOrderCosts(orders: CostOrder[]): CostSummary {
  const totals = new Map<string, { label: string; amount: bigint }>();
  let sales = 0n, covered = 0, eligible = 0, estimated = 0, groupedFees = 0;
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
  return { items: [...totals].map(([key, item]) => ({ key, label: item.label, amount: amountString(item.amount) })), sales: amountString(sales), covered, eligible, estimated, groupedFees };
}

export function costBreakdown(summary: CostSummary, adSpend: string | null) {
  const items = [...summary.items, ...(adSpend === null ? [] : [{ key: "ads", label: "Advertisement", amount: adSpend }])];
  const costs = items.filter(item => amountUnits(item.amount) > 0n);
  const credits = items.filter(item => amountUnits(item.amount) < 0n);
  const total = costs.reduce((sum, item) => sum + amountUnits(item.amount), 0n);
  const sales = amountUnits(summary.sales);
  function percent(amount: bigint, denominator: bigint): number | null {
    return denominator > 0n ? Number((amount * 10_000n + denominator / 2n) / denominator) / 100 : null;
  }
  return {
    total: amountString(total), salesPercentage: percent(total, sales), credits,
    slices: costs.map(item => ({ ...item, value: Number(item.amount), percentage: percent(amountUnits(item.amount), total)!, salesPercentage: percent(amountUnits(item.amount), sales) })),
  };
}
