import { test } from "node:test";
import assert from "node:assert/strict";
import { groupProducts, type ProductVariantRow } from "../src/core/products.ts";

const variant = (overrides: Partial<ProductVariantRow> = {}): ProductVariantRow => ({
  id: "v1", shopId: "shop1", sourceItemId: "100", sourceModelId: "1",
  name: "Old speaker title", variationName: null, nameObservedAt: "2026-10-01T00:00:00.000Z",
  sku: "SPEAKER", cost: 40000, units: 3, ...overrides,
});

test("renamed variations combine by item identity with the newest known title", () => {
  const old = variant();
  const recent = variant({ id: "v2", sourceModelId: "2", name: "Renamed speaker", nameObservedAt: "2026-10-20T00:00:00.000Z", units: 7, cost: 50000 });
  for (const rows of [[old, recent], [recent, old]]) {
    const groups = groupProducts(rows);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].name, "Renamed speaker");
    assert.equal(groups[0].units, 10);
    assert.equal(groups[0].variants.length, 2);
    assert.equal(groups[0].minCost, 40000);
    assert.equal(groups[0].maxCost, 50000);
  }
  assert.equal(old.name, "Old speaker title");
});

test("identical names and SKUs do not merge separate listings or shops", () => {
  const rows = [variant(), variant({ id: "v2", sourceItemId: "101" }), variant({ id: "v3", shopId: "shop2" })];
  assert.equal(groupProducts(rows).length, 3);
});

test("zero and missing costs stay distinct and original variation IDs are preserved", () => {
  const rows = [variant({ cost: 0, units: 0 }), variant({ id: "v2", sourceModelId: "2", cost: null, units: 0 })];
  const [group] = groupProducts(rows);
  assert.equal(group.missingCosts, 1);
  assert.equal(group.minCost, 0);
  assert.equal(group.maxCost, 0);
  assert.deepEqual(group.variants.map(row => row.id), ["v1", "v2"]);
  assert.equal(group.units, 0);
  assert.equal(groupProducts([variant({ cost: null })])[0].minCost, null);
});

test("product ranking sorts combined units and does not modify input order", () => {
  const rows = [variant({ units: 3 }), variant({ id: "v2", sourceItemId: "101", units: 5 }), variant({ id: "v3", sourceModelId: "3", units: 4 })];
  const groups = groupProducts(rows);
  assert.deepEqual(groups.map(group => group.units), [7, 5]);
  assert.deepEqual(rows.map(row => row.id), ["v1", "v2", "v3"]);
  assert.deepEqual(groupProducts([]), []);
});
