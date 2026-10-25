import { AppError } from "./errors.ts";
import { amountString, amountUnits } from "./money.ts";

export type NormalizedReturn = { returnSn: string; orderSn: string; status: string; reportedAmount: string | null; confirmedRefund: string | null; updatedAt: Date };
export function normalizeReturn(raw: unknown): NormalizedReturn {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AppError("INVALID_SOURCE_RETURN", 502);
  const value = raw as Record<string, unknown>;
  for (const key of ["return_sn", "order_sn"]) if (typeof value[key] !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value[key] as string)) throw new AppError("INVALID_SOURCE_RETURN", 502);
  if (value.currency !== "IDR" || typeof value.status !== "string" || typeof value.update_time !== "number" || !Number.isSafeInteger(value.update_time) || value.update_time <= 0) throw new AppError("INCOMPLETE_SOURCE_RETURN", 502);
  let reportedAmount: string | null = null;
  if (value.refund_amount != null) {
    if (typeof value.refund_amount !== "string" && typeof value.refund_amount !== "number") throw new AppError("INVALID_SOURCE_REFUND", 502);
    const units = amountUnits(value.refund_amount);
    if (units < 0n) throw new AppError("INVALID_SOURCE_REFUND", 502);
    reportedAmount = amountString(units);
  }
  return { returnSn: value.return_sn as string, orderSn: value.order_sn as string, status: value.status, reportedAmount, confirmedRefund: value.status === "ACCEPTED" ? reportedAmount : null, updatedAt: new Date(value.update_time * 1000) };
}

// Shopee page_no is an entry offset (starting at zero), not a page number.
export async function importReturnWindow<T extends { return_sn?: unknown }>(options: {
  page: (offset: number) => Promise<{ more: boolean; returns: T[] }>;
  save: (value: T) => Promise<void>;
  shouldPause?: () => boolean;
}) {
  let processed = 0, offset = 0;
  const seen = new Set<string>();
  for (;;) {
    if (options.shouldPause?.()) return { processed, paused: true };
    if (offset >= 50_000) throw new AppError("RETURN_PAGE_LIMIT", 502);
    const result = await options.page(offset);
    for (const value of result.returns) {
      if (options.shouldPause?.()) return { processed, paused: true };
      if (typeof value.return_sn !== "string" || seen.has(value.return_sn)) throw new AppError("REPEATED_SOURCE_RETURN", 502);
      seen.add(value.return_sn);
      await options.save(value);
      processed++;
    }
    if (!result.more) return { processed, paused: false };
    if (!result.returns.length) throw new AppError("MISSING_RETURN_PAGE", 502);
    offset += result.returns.length;
  }
}
