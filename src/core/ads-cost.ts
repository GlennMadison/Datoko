import { amountString, amountUnits } from "./money.ts";
import { AppError } from "./errors.ts";

// Shopee Indonesia paid advertising excludes 11% PPN (terms, section 24.11).
// Source spend stays tax-exclusive. Apply PPN only to reporting expenses.
export const ADS_PPN_PERCENT = 11;

export function advertisingCost(spend: string | number) {
  const base = amountUnits(spend);
  if (base < 0n) throw new AppError("NEGATIVE_ADS_AMOUNT");
  // Round once to the ledger's four decimal places, without floating point.
  const ppn = (base * BigInt(ADS_PPN_PERCENT) + 50n) / 100n;
  return { spend: amountString(base), ppn: amountString(ppn), total: amountString(base + ppn) };
}
