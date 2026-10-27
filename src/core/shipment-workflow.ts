import { AppError } from "./errors.ts";
import { ARRANGED_STATUSES, eligibleForDropoff, hasSplitPackages } from "./auto-process.ts";
import { orderChannelId, packageNumber, shipmentPlan, type CourierRule } from "./courier-shipping.ts";

export type ProcessingState = "CHECKING" | "WAITING" | "SKIPPED" | "REVIEW" | "REQUESTED" | "UNCERTAIN" | "ARRANGED" | "READ_FAILED";
export type ShipmentDependencies = {
  readOrder(): Promise<Record<string, unknown>>;
  readRule(channelId: string): Promise<CourierRule | null>;
  readParameters(order: Record<string, unknown>): Promise<Record<string, unknown>>;
  claimRequest(channelId: string, method: string): Promise<boolean>;
  send(body: Record<string, unknown>): Promise<unknown>;
  save(state: ProcessingState, code?: string): Promise<void>;
};
export async function arrangeShipment(orderSn: string, enabledFrom: Date, deps: ShipmentDependencies, now?: Date) {
  let requested = false;
  const clock = () => now ?? new Date();
  try {
    const order = await deps.readOrder();
    if (order.order_sn !== orderSn) throw new AppError("INCOMPLETE_ORDER_DETAILS", 502);
    if (ARRANGED_STATUSES.includes(String(order.order_status)) || order.order_status !== "READY_TO_SHIP") {
      await deps.save("SKIPPED", "ORDER_NO_LONGER_ELIGIBLE"); return;
    }
    const alreadyRequested = (value: Record<string, unknown>) => Array.isArray(value.package_list) && value.package_list.some(p => p && typeof p === "object" && typeof p.logistics_status === "string" && p.logistics_status && p.logistics_status !== "LOGISTICS_READY");
    if (alreadyRequested(order)) { await deps.save("SKIPPED", "ORDER_NO_LONGER_ELIGIBLE"); return; }
    if (order.cod === true) { await deps.save("SKIPPED", "COD_EXCLUDED"); return; }
    if (hasSplitPackages(order)) throw new AppError("SPLIT_ORDER", 409);
    const channelId = orderChannelId(order);
    if (!channelId) throw new AppError("COURIER_UNKNOWN", 409);
    const rule = await deps.readRule(channelId);
    if (!rule?.enabled) { await deps.save("SKIPPED", "COURIER_DISABLED"); return; }
    const activeFrom = new Date(Math.max(enabledFrom.getTime(), rule.enabledFrom.getTime()));
    if (typeof order.create_time === "number" && order.create_time * 1000 < activeFrom.getTime()) {
      await deps.save("SKIPPED", "ORDER_BEFORE_ACTIVATION"); return;
    }
    if (!eligibleForDropoff(order, activeFrom, clock())) { await deps.save("WAITING", "PAYMENT_OR_WAITING_PERIOD"); return; }
    const packageId = packageNumber(order);
    const plan = shipmentPlan(orderSn, await deps.readParameters(order), rule, clock(), packageId);
    const fresh = await deps.readOrder();
    if (fresh.order_sn !== orderSn) throw new AppError("INCOMPLETE_ORDER_DETAILS", 502);
    if (!eligibleForDropoff(fresh, activeFrom, clock()) || hasSplitPackages(fresh) || alreadyRequested(fresh) || orderChannelId(fresh) !== channelId || packageNumber(fresh) !== packageId) {
      await deps.save("SKIPPED", "ORDER_NO_LONGER_ELIGIBLE"); return;
    }
    // Persist the claim before ship_order. A lost response is never retried.
    requested = true;
    if (!await deps.claimRequest(channelId, plan.method)) return;
    await deps.send(plan.body);
    await deps.save("ARRANGED");
  } catch (error) {
    const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
    const state = requested ? "UNCERTAIN" : code === "PICKUP_UNAVAILABLE" ? "WAITING" : error instanceof AppError && error.status === 409 ? "REVIEW" : "READ_FAILED";
    await deps.save(state, code);
  }
}
