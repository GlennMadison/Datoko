export type CancellationOrder = { status: string; paymentStatus: string; returns: { status: string }[] };
export function cancellationBreakdown(orders: CancellationOrder[]) {
  const result = { all: 0, paid: 0, unpaid: 0, returned: 0, unknown: 0 };
  for (const order of orders) {
    if (order.status !== "CANCELLED") continue;
    result.all++;
    if (order.returns.some(value => value.status === "ACCEPTED")) result.returned++;
    else if (order.paymentStatus === "PAID") result.paid++;
    else if (order.paymentStatus === "UNPAID") result.unpaid++;
    else result.unknown++;
  }
  return result;
}
