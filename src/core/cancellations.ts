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

export function cancellationDetails(summary: ReturnType<typeof cancellationBreakdown>) {
  return [
    { key: "unpaid", label: "Before payment", count: summary.unpaid },
    { key: "paid", label: "After payment", count: summary.paid },
    { key: "returned", label: "Returned", count: summary.returned },
    ...(summary.unknown ? [{ key: "unknown", label: "Payment unconfirmed", count: summary.unknown }] : []),
  ];
}
