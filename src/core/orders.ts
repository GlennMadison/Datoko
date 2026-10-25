import { AppError } from "./errors.ts";
import { amountString, amountUnits } from "./money.ts";
import { externalId } from "./shopee.ts";
import { digest } from "./security.ts";

export type NormalizedItem = { lineKey: string; itemId: string; modelId: string; name: string; sku: string | null; quantity: number; originalUnitPrice: string; paidUnitPrice: string };
export type NormalizedOrder = { orderSn: string; status: string; currency: string; totalAmount: string; merchandiseAmount: string; createdAt: Date; updatedAt: Date; items: NormalizedItem[] };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("INVALID_SOURCE_ORDER", 502);
  return value as Record<string, unknown>;
}

function timestamp(value: unknown): Date {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new AppError("INVALID_SOURCE_TIMESTAMP", 502);
  return new Date(value * 1000);
}

function money(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") throw new AppError("MISSING_SOURCE_AMOUNT", 502);
  const units = amountUnits(value);
  if (units < 0n) throw new AppError("INVALID_SOURCE_AMOUNT", 502);
  return amountString(units);
}

export function normalizeOrder(raw: unknown): NormalizedOrder {
  const source = object(raw);
  if (typeof source.order_sn !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(source.order_sn)) throw new AppError("INVALID_SOURCE_ORDER", 502);
  if (source.currency !== "IDR" || typeof source.order_status !== "string" || !Array.isArray(source.item_list)) throw new AppError("INCOMPLETE_SOURCE_ORDER", 502);
  const lineCounts = new Map<string, number>();
  const candidates = source.item_list.map(value => {
    const item = object(value);
    const itemId = externalId(item.item_id);
    const modelId = externalId(item.model_id ?? 0);
    const quantity = item.model_quantity_purchased;
    if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1) throw new AppError("INVALID_SOURCE_QUANTITY", 502);
    const explicitLine = item.order_item_id ? externalId(item.order_item_id) : null;
    const identity = [itemId, modelId, item.promotion_type ?? "", item.promotion_id ?? "", item.promotion_group_id ?? "", item.add_on_deal_id ?? "", item.is_main_item ?? ""];
    const composite = digest(JSON.stringify(identity));
    const qualifiedComposite = digest(JSON.stringify([...identity, item.main_item ?? ""]));
    if (explicitLine) lineCounts.set(explicitLine, (lineCounts.get(explicitLine) ?? 0) + 1);
    return { explicitLine, composite, qualifiedComposite, itemId, modelId, name: String(item.item_name ?? "Unnamed item"), sku: String(item.model_sku || item.item_sku || "") || null, quantity, originalUnitPrice: money(item.model_original_price), paidUnitPrice: money(item.model_discounted_price) };
  });
  const used = new Set<string>();
  const items = candidates.map(({ explicitLine, composite, qualifiedComposite, ...item }) => {
    // Shopee reuses order_item_id for bundle items and listing variations.
    // Qualify shared IDs with stable product/promotion identity, never row
    // position, quantity, price, or display text. Preserve singleton and legacy
    // fallback keys so reimporting saved orders cannot duplicate their items.
    const lineKey = explicitLine
      ? `line:${explicitLine}${lineCounts.get(explicitLine)! > 1 ? `:${qualifiedComposite}` : ""}`
      : `composite:${composite}`;
    if (used.has(lineKey)) throw new AppError("AMBIGUOUS_SOURCE_LINES", 502);
    used.add(lineKey);
    return { lineKey, ...item };
  });
  const merchandise = items.reduce((sum, item) => sum + amountUnits(item.paidUnitPrice) * BigInt(item.quantity), 0n);
  return { orderSn: source.order_sn, status: source.order_status, currency: "IDR", totalAmount: money(source.total_amount), merchandiseAmount: amountString(merchandise), createdAt: timestamp(source.create_time), updatedAt: timestamp(source.update_time), items };
}
