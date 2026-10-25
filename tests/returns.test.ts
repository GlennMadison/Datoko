import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeReturn } from "../src/core/returns.ts";
import { cancellationBreakdown } from "../src/core/cancellations.ts";

const source = { return_sn: "RETURN1", order_sn: "ORDER1", currency: "IDR", refund_amount: "100000.1250", status: "REQUESTED", update_time: 1792069200 };
test("requested refunds are not confirmed and accepted amounts preserve precision", () => {
  assert.equal(normalizeReturn(source).confirmedRefund, null);
  assert.equal(normalizeReturn({ ...source, status: "ACCEPTED" }).confirmedRefund, "100000.1250");
  assert.equal(normalizeReturn({ ...source, status: "CANCELLED" }).confirmedRefund, null);
});
test("incomplete returns never fabricate zero-value refunds", () => {
  assert.equal(normalizeReturn({ ...source, refund_amount: undefined }).reportedAmount, null);
  assert.throws(() => normalizeReturn({ ...source, currency: "USD" }));
  assert.throws(() => normalizeReturn({ ...source, refund_amount: "-1" }));
  assert.throws(() => normalizeReturn({ ...source, update_time: 0 }));
});
test("paid and unpaid cancellations, accepted returns and unknown payment details stay distinct", () => {
  const order = (paymentStatus: string, returns: { status: string }[] = []) => ({ status: "CANCELLED", paymentStatus, returns });
  const result = cancellationBreakdown([order("PAID"), order("UNPAID"), order("UNKNOWN"), order("PAID", [{ status: "ACCEPTED" }]), order("PAID", [{ status: "CANCELLED" }]), { ...order("PAID"), status: "COMPLETED" }]);
  assert.deepEqual(result, { all: 5, paid: 2, unpaid: 1, returned: 1, unknown: 1 });
  assert.equal(result.paid + result.unpaid + result.returned + result.unknown, result.all);
});
