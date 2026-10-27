import { AppError } from "./errors.ts";

export type CourierRule = {
  channelId: string; enabled: boolean; enabledFrom: Date; method: string;
  pickupAddressId: string | null; fallbackDropoff: boolean;
  branchId: string | null; senderRealName: string | null;
};
export type CourierChannel = { id: string; name: string; enabled: boolean };
export type PickupAddress = { id: string; label: string };
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const records = (v: unknown) => Array.isArray(v) ? v.map(record) : [];
export function sourceId(v: unknown): string | null {
  if (typeof v === "number" && (!Number.isSafeInteger(v) || v <= 0)) return null;
  if (typeof v === "number") return String(v);
  if (typeof v !== "string" || !/^[1-9]\d{0,15}$/.test(v) || !Number.isSafeInteger(Number(v))) return null;
  return v;
}
export function courierCatalog(raw: Record<string, unknown>): CourierChannel[] {
  if (!Array.isArray(raw.logistics_channel_list)) throw new AppError("SHIPPING_PARAMETERS_INVALID", 502);
  const list = records(raw.logistics_channel_list).map(c => {
    const id = sourceId(c.logistics_channel_id);
    if (!id || typeof c.logistics_channel_name !== "string" || typeof c.enabled !== "boolean") throw new AppError("SHIPPING_PARAMETERS_INVALID", 502);
    return { id, name: c.logistics_channel_name, enabled: c.enabled };
  });
  if (new Set(list.map(c => c.id)).size !== list.length) throw new AppError("SHIPPING_PARAMETERS_INVALID", 502);
  return list.sort((a,b) => a.name.localeCompare(b.name));
}
export function pickupAddresses(raw: Record<string, unknown>): PickupAddress[] {
  if (!Array.isArray(raw.address_list)) throw new AppError("SHIPPING_PARAMETERS_INVALID", 502);
  return records(raw.address_list).filter(a => Array.isArray(a.address_flag) && a.address_flag.includes("pickup_address") && a.address_status !== "DISABLED").flatMap(a => {
    const id = sourceId(a.address_id);
    if (!id) return [];
    const label = [a.name, a.address, a.district, a.city].filter(v => typeof v === "string" && v).join(", ");
    return [{ id, label: label || "Pickup address " + id }];
  });
}
export function orderChannelId(order: Record<string, unknown>): string | null {
  const ids = [...new Set(records(order.package_list).map(p => sourceId(p.logistics_channel_id)).filter((v): v is string => Boolean(v)))];
  const direct = sourceId(order.logistics_channel_id);
  if (direct && ids.some(id => id !== direct)) return null;
  return ids.length === 1 ? ids[0] : ids.length ? null : direct;
}
export function packageNumber(order: Record<string, unknown>): string | undefined {
  const p = records(order.package_list);
  return p.length === 1 && typeof p[0].package_number === "string" && p[0].package_number ? p[0].package_number : undefined;
}
function needs(parameters: Record<string, unknown>, method: string): string[] {
  const needed = record(parameters.info_needed)[method];
  if (!Array.isArray(needed) || needed.some(v => typeof v !== "string")) throw new AppError(method === "pickup" ? "PICKUP_UNAVAILABLE" : "DROPOFF_UNAVAILABLE", 409);
  return needed as string[];
}
function dropoff(parameters: Record<string, unknown>, rule: CourierRule): Record<string, unknown> {
  const required = needs(parameters, "dropoff");
  if (required.some(v => !["branch_id", "sender_real_name"].includes(v))) throw new AppError("DROPOFF_DETAILS_REQUIRED", 409);
  const body: Record<string, unknown> = {};
  if (required.includes("branch_id")) {
    const branches = records(record(parameters.dropoff).branch_list);
    if (!rule.branchId || !branches.some(b => sourceId(b.branch_id) === rule.branchId)) throw new AppError("DROPOFF_DETAILS_REQUIRED", 409);
    body.branch_id = Number(rule.branchId);
  }
  if (required.includes("sender_real_name")) {
    if (!rule.senderRealName?.trim()) throw new AppError("DROPOFF_DETAILS_REQUIRED", 409);
    body.sender_real_name = rule.senderRealName.trim();
  }
  return body;
}
function pickup(parameters: Record<string, unknown>, rule: CourierRule, now: Date): Record<string, unknown> {
  const required = needs(parameters, "pickup");
  if (required.some(v => !["address_id", "pickup_time_id"].includes(v))) throw new AppError("PICKUP_DETAILS_REQUIRED", 409);
  const address = records(record(parameters.pickup).address_list).find(a => sourceId(a.address_id) === rule.pickupAddressId);
  if (!address || !rule.pickupAddressId) throw new AppError("PICKUP_UNAVAILABLE", 409);
  const slots = records(address.time_slot_list).filter(s => {
    if (typeof s.pickup_time_id !== "string" || !s.pickup_time_id) return false;
    // Indonesian shop pickup dates use WIB, independent of the server timezone.
    const today = Math.floor((now.getTime() + 7 * 3_600_000) / 86_400_000) * 86_400_000 - 7 * 3_600_000;
    if (typeof s.date === "number") return s.date * 1000 >= today;
    return true;
  }).sort((a,b) => Number(Array.isArray(b.flags) && b.flags.includes("recommended")) - Number(Array.isArray(a.flags) && a.flags.includes("recommended")) || Number(a.date ?? 0) - Number(b.date ?? 0));
  if (required.includes("pickup_time_id") && !slots.length) throw new AppError("PICKUP_UNAVAILABLE", 409);
  return { address_id: Number(rule.pickupAddressId), ...(slots[0] ? { pickup_time_id: slots[0].pickup_time_id } : {}) };
}
export function shipmentPlan(orderSn: string, parameters: Record<string, unknown>, rule: CourierRule, now = new Date(), packageId?: string) {
  const base = { order_sn: orderSn, ...(packageId ? { package_number: packageId } : {}) };
  if (rule.method === "dropoff") return { method: "dropoff", body: { ...base, dropoff: dropoff(parameters, rule) } };
  if (rule.method !== "pickup") throw new AppError("INVALID_SETTING", 409);
  try { return { method: "pickup", body: { ...base, pickup: pickup(parameters, rule, now) } }; }
  catch (error) {
    if (!(error instanceof AppError) || error.code !== "PICKUP_UNAVAILABLE" || !rule.fallbackDropoff) throw error;
    return { method: "dropoff", body: { ...base, dropoff: dropoff(parameters, rule) } };
  }
}
