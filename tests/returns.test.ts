import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeReturn, importReturnWindow } from "../src/core/returns.ts";
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

test("return import starts at entry zero and retains a sole return", async () => {
  const offsets: number[] = [], saved: string[] = [];
  const result = await importReturnWindow({ page: async offset => { offsets.push(offset); return { more: false, returns: [{ return_sn: "ONLY" }] }; }, save: async value => { saved.push(value.return_sn); } });
  assert.deepEqual(offsets, [0]); assert.deepEqual(saved, ["ONLY"]); assert.equal(result.processed, 1);
});
test("return pagination advances by entries and refuses repeated source records", async () => {
  const offsets: number[] = [];
  const result = await importReturnWindow({ page: async offset => { offsets.push(offset); return { more: offset === 0, returns: offset === 0 ? Array.from({ length: 50 }, (_, i) => ({ return_sn: "R" + i })) : [{ return_sn: "LAST" }] }; }, save: async () => {} });
  assert.deepEqual(offsets, [0, 50]); assert.equal(result.processed, 51);
  await assert.rejects(importReturnWindow({ page: async () => ({ more: true, returns: [{ return_sn: "REPEAT" }] }), save: async () => {} }), /REPEATED_SOURCE_RETURN/);
});
