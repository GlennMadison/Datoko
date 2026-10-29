import { amountString, amountUnits } from "./money.ts";
import { advertisingCost } from "./ads-cost.ts";

/** Source ad spend plus PPN is deducted once after order payouts and COGS. */
export function profitAfterAdSpend(orderProfit: string | number | null, adSpend: string | number | null): number | null {
  if (orderProfit === null || adSpend === null) return null;
  return Number(amountString(amountUnits(orderProfit) - amountUnits(advertisingCost(adSpend).total)));
}
