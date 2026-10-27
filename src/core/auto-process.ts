import { AppError } from "./errors.ts";

export const PROCESSING_WAIT_MS = 60 * 60 * 1000;
export const ARRANGED_STATUSES = ["PROCESSED", "SHIPPED", "TO_CONFIRM_RECEIVE", "COMPLETED"];

// Require positive payment evidence; leave COD and unknown statuses to the seller.
export function eligibleForDropoff(order: Record<string, unknown>, enabledFrom: Date, now = new Date()): boolean {
  const created = order.create_time;
  const paid = order.pay_time;
  return order.order_status === "READY_TO_SHIP" && order.cod !== true &&
    typeof created === "number" && Number.isSafeInteger(created) && created > 0 &&
    typeof paid === "number" && Number.isSafeInteger(paid) && paid >= created &&
    created * 1000 >= enabledFrom.getTime() &&
    Math.max(created, paid) * 1000 <= now.getTime() - PROCESSING_WAIT_MS;
}

// Empty dropoff requirements mean send dropoff: {}. Never invent courier details.
export function dropoffBody(orderSn: string, parameters: Record<string, unknown>): Record<string, unknown> {
  const needed = parameters.info_needed;
  if (!needed || typeof needed !== "object" || Array.isArray(needed)) throw new AppError("SHIPPING_PARAMETERS_INVALID", 502);
  const dropoff = (needed as Record<string, unknown>).dropoff;
  if (!Array.isArray(dropoff)) throw new AppError("DROPOFF_UNAVAILABLE", 409);
  if (dropoff.length) throw new AppError("DROPOFF_DETAILS_REQUIRED", 409);
  return { order_sn: orderSn, dropoff: {} };
}

export function hasSplitPackages(order: Record<string, unknown>): boolean {
  return Array.isArray(order.package_list) && order.package_list.length > 1;
}

export function processingMessage(code: string | null): string {
  const messages: Record<string, string> = {
    PREFLIGHT_RETRY_EXHAUSTED: "Availability checks were exhausted. Arrange shipment in Shopee.",
    PICKUP_UNAVAILABLE: "Pickup is unavailable for this order or address. Waiting for the next check.",
    PICKUP_DETAILS_REQUIRED: "Pickup needs extra details. Arrange shipment in Shopee.",
    COURIER_UNKNOWN: "Shopee did not return a unique courier service ID. Arrange shipment in Shopee.",
    COURIER_DISABLED: "Automatic processing is off for this courier service.",
    ORDER_BEFORE_ACTIVATION: "Order was placed before automation was enabled for this courier.",
    COD_EXCLUDED: "COD orders require manual shipment arrangement.",
    PAYMENT_OR_WAITING_PERIOD: "Waiting for payment confirmation and the one-hour waiting period.",
    DROPOFF_UNAVAILABLE: "This courier does not offer automatic drop-off. Arrange shipment in Shopee.",
    DROPOFF_DETAILS_REQUIRED: "The courier requires extra details. Arrange shipment in Shopee.",
    SPLIT_ORDER: "This order has multiple packages. Arrange shipment in Shopee.",
    SHIPPING_PARAMETERS_INVALID: "Shopee returned incomplete shipping requirements. Check the order in Shopee.",
    SHOPEE_PERMISSION_DENIED: "Shopee logistics permission is missing. Check your app permissions and reconnect.",
    SHOPEE_API_ERROR: "Shopee rejected the request. Check the order in Seller Centre.",
    SHOPEE_REQUEST_UNCERTAIN: "The result could not be confirmed. Check Shopee before arranging shipment again.",
    REQUEST_INTERRUPTED: "A request may have reached Shopee. Check Seller Centre before retrying.",
    ORDER_NO_LONGER_ELIGIBLE: "The order is no longer eligible for automatic processing.",
    INTERNAL_ERROR: "Processing stopped. Check the order in Shopee.",
  };
  return code ? messages[code] ?? `Processing stopped (${code}). Check the order in Shopee.` : "Shipment arranged.";
}
