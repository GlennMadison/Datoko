import { amountString, amountUnits } from "./money.ts";

export type SalesOrder = {
  status: string;
  paymentStatus?: string;
  merchandise: string;
  settlementRefund?: string | null;
  returns?: { id: string; status: string; confirmedRefund: string | null }[];
};

/** Cancelled orders remain in the status history, including before-payment cancellations. */
export function isOverviewOrder(order: { status: string; paymentStatus?: string }) {
  return order.status === "CANCELLED" || (order.status !== "UNPAID" && order.paymentStatus !== "UNPAID");
}

export function isPaidSale(order: { status: string; paymentStatus?: string }) {
  if (!isOverviewOrder(order) || ["CANCELLED", "IN_CANCEL"].includes(order.status)) return false;
  return order.paymentStatus === "PAID" || ["READY_TO_SHIP", "PROCESSED", "SHIPPED", "TO_CONFIRM_RECEIVE", "COMPLETED", "TO_RETURN"].includes(order.status);
}

/** Return cases and escrow can describe the same refund. Restate the checkout date once. */
export function netOrderSales(order: SalesOrder): string {
  if (!isPaidSale(order)) return "0.0000";
  const gross = amountUnits(order.merchandise);
  const refunds = new Map<string, bigint>();
  for (const value of order.returns ?? []) {
    if (value.status === "ACCEPTED" && value.confirmedRefund !== null) refunds.set(value.id, amountUnits(value.confirmedRefund));
  }
  const caseRefund = [...refunds.values()].reduce((sum, value) => sum + value, 0n);
  const escrowRefund = amountUnits(order.settlementRefund ?? "0");
  const refund = caseRefund > escrowRefund ? caseRefund : escrowRefund;
  return amountString(gross > refund ? gross - refund : 0n);
}
