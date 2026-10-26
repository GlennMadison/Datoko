import { amountString, amountUnits } from "./money.ts";
import { AppError } from "./errors.ts";
import { OTHER_SHOPEE_FEES } from "./cost-breakdown.ts";

export type Settlement = {
  payout: string; commission: string; service: string; transaction: string;
  affiliate: string; other: string; refunds: string; adjustment: string;
  feeDetails?: Record<string, string>;
};

// Payout already includes fees, refunds and adjustments. Never deduct twice.
export function normalizeSettlement(raw: Record<string, unknown>, orderSn: string): Settlement {
  if (raw.order_sn !== orderSn) throw new AppError("SETTLEMENT_ORDER_MISMATCH", 502);
  const income = raw.order_income;
  if (!income || typeof income !== "object" || Array.isArray(income)) throw new AppError("SETTLEMENT_NOT_AVAILABLE", 502);
  const source = income as Record<string, unknown>;
  function read(key: string, required = false): bigint {
    const value = source[key];
    if (value === undefined || value === null) {
      if (required) throw new AppError("SETTLEMENT_NOT_AVAILABLE", 502);
      return 0n;
    }
    if (typeof value !== "string" && typeof value !== "number") throw new AppError("INVALID_SETTLEMENT_AMOUNT", 502);
    return amountUnits(value);
  }
  const base = read("escrow_amount", true);
  const payout = source.escrow_amount_after_adjustment == null ? base : read("escrow_amount_after_adjustment", true);
  const feeDetails = Object.fromEntries(Object.keys(OTHER_SHOPEE_FEES).map(key => [key, amountString(read(key))]));
  const other = Object.values(feeDetails).reduce((sum, amount) => sum + amountUnits(amount), 0n);
  return { feeDetails, payout: amountString(payout), commission: amountString(read("commission_fee")), service: amountString(read("service_fee")), transaction: amountString(read("seller_transaction_fee")), affiliate: amountString(read("order_ams_commission_fee")), other: amountString(other), refunds: amountString(read("seller_return_refund") < 0n ? -read("seller_return_refund") : 0n), adjustment: amountString(payout - base) };
}

export function readSettlement(value: unknown): Settlement | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const keys = ["payout", "commission", "service", "transaction", "affiliate", "other", "refunds", "adjustment"] as const;
  try {
    for (const key of keys) {
      if (typeof source[key] !== "string") return null;
      amountUnits(source[key] as string);
    }
    if (source.feeDetails !== undefined) {
      const details = source.feeDetails;
      if (!details || typeof details !== "object" || Array.isArray(details)) return null;
      let total = 0n;
      for (const [key, amount] of Object.entries(details)) {
        if (!(Object.hasOwn(OTHER_SHOPEE_FEES, key)) || typeof amount !== "string") return null;
        total += amountUnits(amount);
      }
      if (total !== amountUnits(source.other as string)) return null;
    }
    return source as Settlement;
  } catch { return null; }
}

export type OrderProfit = { cogs: string | null; payout: string | null; profit: string | null; quality: "SETTLED" | "ESTIMATED" | "MISSING_COST" | "MISSING_SETTLEMENT" | "EXCLUDED" };
export function calculateOrderProfit(order: { status: string; items: { quantity: number; costSnapshot: string | null; costQuality?: string }[] }, settlement: Settlement | null): OrderProfit {
  const missing = !order.items.length || order.items.some(item => item.costSnapshot === null);
  const cogs = missing ? null : amountString(order.items.reduce((sum, item) => {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new AppError("INVALID_SOURCE_QUANTITY");
    const cost = amountUnits(item.costSnapshot!);
    if (cost < 0n) throw new AppError("INVALID_COST");
    return sum + cost * BigInt(item.quantity);
  }, 0n));
  const payout = settlement?.payout ?? null;
  if (["CANCELLED", "IN_CANCEL", "UNPAID"].includes(order.status)) return { cogs, payout, profit: null, quality: "EXCLUDED" };
  if (!settlement) return { cogs, payout, profit: null, quality: "MISSING_SETTLEMENT" };
  if (cogs === null) return { cogs, payout, profit: null, quality: "MISSING_COST" };
  const estimatedCost = order.items.some(item => item.costQuality === "CURRENT_ESTIMATE" || item.costQuality === "HISTORICAL_BASELINE");
  return { cogs, payout, profit: amountString(amountUnits(payout!) - amountUnits(cogs)), quality: order.status === "COMPLETED" && !estimatedCost ? "SETTLED" : "ESTIMATED" };
}
