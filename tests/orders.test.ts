import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOrder } from "../src/core/orders.ts";

const item = { item_id: "9007199254740993", model_id: 0, item_name: "Speaker stand", model_quantity_purchased: 2, model_original_price: "55000", model_discounted_price: "50000", item_sku: "MR4-BK" };
const source = { order_sn: "261015ORDER", currency: "IDR", order_status: "COMPLETED", total_amount: "115000", create_time: 1792065600, update_time: 1792069200, item_list: [item] };

test("merchandise value excludes buyer shipping in total_amount", () => {
  const order = normalizeOrder(source);
  assert.equal(order.totalAmount, "115000.0000");
  assert.equal(order.merchandiseAmount, "100000.0000");
  assert.equal(order.items[0].itemId, "9007199254740993");
});
test("stable line IDs are independent of returned line ordering", () => {
  const second = { ...item, model_id: 2 };
  const a = normalizeOrder({ ...source, item_list: [item, second] });
  const b = normalizeOrder({ ...source, item_list: [second, item] });
  assert.equal(a.items[0].lineKey, b.items[1].lineKey);
});
test("ambiguous repeated lines fail rather than merging or overwriting", () => {
  assert.throws(() => normalizeOrder({ ...source, item_list: [item, item] }), /AMBIGUOUS_SOURCE_LINES/);
});
test("missing source fields do not turn into fabricated zero-value sales", () => {
  assert.throws(() => normalizeOrder({ ...source, total_amount: undefined }));
  assert.throws(() => normalizeOrder({ ...source, item_list: undefined }));
});
