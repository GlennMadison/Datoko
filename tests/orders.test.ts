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

test("different variations sharing Shopee's order_item_id retain both quantities and values", () => {
  const black = { ...item, order_item_id: "123", model_id: "10" };
  const white = { ...black, model_id: "11", model_quantity_purchased: 1, model_discounted_price: "45000" };
  const order = normalizeOrder({ ...source, item_list: [black, white] });
  assert.equal(order.items.length, 2);
  assert.equal(new Set(order.items.map(line => line.lineKey)).size, 2);
  assert.deepEqual(order.items.map(line => [line.modelId, line.quantity, line.paidUnitPrice]), [["10", 2, "50000.0000"], ["11", 1, "45000.0000"]]);
  assert.equal(order.merchandiseAmount, "145000.0000");
});

test("bundle products with the same order_item_id remain separate and stable on replay", () => {
  const first = { ...item, order_item_id: "1", promotion_type: "bundle_deal", promotion_id: "200" };
  const second = { ...first, item_id: "9007199254740994" };
  const a = normalizeOrder({ ...source, item_list: [first, second] });
  const b = normalizeOrder({ ...source, order_status: "SHIPPED", item_list: [second, first] });
  assert.equal(a.items[0].lineKey, b.items[1].lineKey);
  assert.equal(a.items[1].lineKey, b.items[0].lineKey);
  assert.notEqual(a.items[0].lineKey, a.items[1].lineKey);
  assert.equal(a.merchandiseAmount, "200000.0000");
  assert.equal(b.merchandiseAmount, a.merchandiseAmount);
});

test("shared line IDs distinguish promotion groups for the same product and model", () => {
  const first = { ...item, order_item_id: "1", promotion_group_id: "30" };
  const second = { ...first, promotion_group_id: "31", model_discounted_price: "40000" };
  const order = normalizeOrder({ ...source, item_list: [first, second] });
  assert.notEqual(order.items[0].lineKey, order.items[1].lineKey);
  assert.equal(order.merchandiseAmount, "180000.0000");
});

test("shared line keys exclude mutable display and price fields", () => {
  const first = { ...item, order_item_id: "1", model_id: "10" };
  const second = { ...first, model_id: "11" };
  const a = normalizeOrder({ ...source, item_list: [first, second] });
  const b = normalizeOrder({ ...source, item_list: [{ ...first, item_name: "Renamed", item_sku: "RENAMED", model_quantity_purchased: 3, model_discounted_price: "49000" }, second] });
  assert.equal(a.items[0].lineKey, b.items[0].lineKey);
});

test("existing singleton line IDs are preserved across reimports", () => {
  const a = normalizeOrder({ ...source, item_list: [{ ...item, order_item_id: "42" }] });
  assert.equal(a.items[0].lineKey, "line:42");
});

test("genuinely indistinguishable shared IDs still fail without guessing or dropping sales", () => {
  const line = { ...item, order_item_id: "1" };
  assert.throws(() => normalizeOrder({ ...source, item_list: [line, line] }), /AMBIGUOUS_SOURCE_LINES/);
  assert.throws(() => normalizeOrder({ ...source, item_list: [line, { ...line, model_discounted_price: "40000" }] }), /AMBIGUOUS_SOURCE_LINES/);
});

test("Shopee's main_item field distinguishes shared add-on main and secondary items", () => {
  const main = { ...item, order_item_id: "1", main_item: true };
  const addon = { ...main, main_item: false };
  const order = normalizeOrder({ ...source, item_list: [main, addon] });
  assert.notEqual(order.items[0].lineKey, order.items[1].lineKey);
});