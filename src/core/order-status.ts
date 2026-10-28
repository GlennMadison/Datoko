import { isOverviewOrder } from "./overview-sales.ts";

const stages = [
  { status: "READY_TO_SHIP", label: "Awaiting processing" },
  { status: "PROCESSED", label: "Processing" },
  { status: "SHIPPED", label: "In shipping" },
  { status: "TO_CONFIRM_RECEIVE", label: "Awaiting confirmation" },
];

export function orderStatusSummary(orders: readonly { status: string; paymentStatus?: string }[]) {
  const counts = new Map<string, number>();
  for (const order of orders) {
    if (!isOverviewOrder(order)) continue;
    counts.set(order.status, (counts.get(order.status) ?? 0) + 1);
  }
  const completed = counts.get("COMPLETED") ?? 0;
  const cancelled = counts.get("CANCELLED") ?? 0;
  const details = stages.map(stage => ({ ...stage, count: counts.get(stage.status) ?? 0 }));
  for (const [status, count] of counts) {
    if (["COMPLETED", "CANCELLED", ...stages.map(stage => stage.status)].includes(status)) continue;
    details.push({ status, label: status === "IN_CANCEL" ? "Cancellation requested" : status === "TO_RETURN" ? "Return in progress" : status.toLowerCase().replaceAll("_", " ").replace(/^./, first => first.toUpperCase()), count });
  }
  const inProgress = details.reduce((sum, detail) => sum + detail.count, 0);
  return { total: completed + cancelled + inProgress, completed, cancelled, inProgress, details };
}
