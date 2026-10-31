import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolveReportPeriod } from "../src/core/reporting-period.ts";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.toLowerCase().includes("test")) throw new Error("Use a dedicated TEST_DATABASE_URL containing 'test'.");
Object.assign(process.env, { DATABASE_URL: url, DATOKO_MODE: "live", SHOPEE_ENV: "sandbox" });
const { getDb, closeDb } = await import("../src/server/db.ts");
const { reportShop, touchReportShop } = await import("../src/server/report-context.ts");
const { reportOrders, reportProducts } = await import("../src/server/report-queries.ts");
const { ordersForShop } = await import("../src/server/page-data.ts");
const { dashboardForShop } = await import("../src/server/dashboard.ts");

test("bounded report queries preserve latest revisions, money, filters and owner boundaries", async () => {
  const db = getDb(), ownerId = "usage-" + randomUUID();
  await db.user.create({ data: { id: ownerId, name: "Usage fixture", email: ownerId + "@example.test" } });
  const shop = await db.shop.create({ data: { ownerId, environment: "sandbox", sourceShopId: randomUUID(), name: "Report fixture" } });
  const foreign = await db.shop.create({ data: { ownerId, environment: "production", sourceShopId: randomUUID(), name: "Other shop" } });
  const variant = await db.productVariant.create({ data: { shopId: shop.id, sourceItemId: "fixture-product", sourceModelId: "0", name: "Original title" } });
  const foreignOrder = await db.order.create({ data: { shopId: foreign.id, orderSn: "private", status: "COMPLETED", totalAmount: "999", merchandiseAmount: "999", sourceCreatedAt: new Date("2026-10-02T02:00Z"), sourceUpdatedAt: new Date() } });
  const period = resolveReportPeriod({ preset: "custom", from: "2026-10-02", to: "2026-10-02", interval: "day" });
  const amounts = (payout: string) => ({ payout, commission: "1", service: "1", transaction: "0", affiliate: "0", other: "0", refunds: "0", adjustment: "0" });
  const ids: string[] = [];
  try {
    for (let index = 0; index < 32; index++) {
      const order = await db.order.create({ data: { shopId: shop.id, orderSn: "fixture-" + String(index).padStart(2, "0"),
        status: index === 31 ? "UNPAID" : "COMPLETED", paymentStatus: index === 31 ? "UNPAID" : "PAID",
        totalAmount: "100.1250", merchandiseAmount: "100.1250", sourceCreatedAt: new Date(Date.parse("2026-10-02T02:00Z") + index * 60_000), sourceUpdatedAt: new Date(),
        items: { create: { variantId: variant.id, sourceLineKey: "line", name: "Title " + index, sku: "fixture", quantity: 1, paidUnitPrice: "100.1250", originalUnitPrice: "100.1250", costSnapshot: "20.1250" } },
        financialSnapshots: { create: { source: "SHOPEE_ESCROW", sourceKey: "fixture", hash: String(index), revision: 1, amounts: amounts("90.1250") } } } });
      ids.push(order.id);
    }
    await db.financialSnapshot.createMany({ data: Array.from({ length: 99 }, (_, index) => ({ orderId: ids[0], source: "SHOPEE_ESCROW", sourceKey: "fixture", hash: "revision-" + index, revision: index + 2, amounts: amounts("60.1250") })) });
    await db.skuCostVersion.createMany({ data: [1, 2, 3].map(index => ({ variantId: variant.id, amount: String(index), effectiveAt: new Date(2020 + index, 0, 1), createdBy: ownerId })) });
    let context = (await reportShop(ownerId, "sandbox"))!;
    assert.equal(await reportShop("outsider", "sandbox"), null);
    const selected = await reportOrders(db, shop.id, period.fromISO, period.effectiveToISO, [ids[0], foreignOrder.id]);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].financialSnapshots.length, 1);
    assert.equal((selected[0].financialSnapshots[0].amounts as { payout: string }).payout, "60.1250");
    const products = await reportProducts(shop.id);
    assert.equal(products.length, 1); assert.equal(products[0].orderItems.length, 1);
    assert.equal(products[0].orderItems[0].name, "Title 31"); assert.equal(products[0].costs[0].amount, "3.0000");
    const first = await ordersForShop(context, period, { size: "10" });
    const second = await ordersForShop(context, period, { size: "10", page: "2" });
    assert.equal(first.total, 32); assert.equal(first.orders.length, 10); assert.equal(second.orders.length, 10);
    assert.equal(new Set([...first.orders, ...second.orders].map(o => o.id)).size, 20);
    assert.equal(first.trend.reduce((sum, p) => sum + (p.orders ?? 0), 0), 31);
    assert.equal((await ordersForShop(context, period, { q: "%" })).total, 0);
    assert.equal((await ordersForShop(context, period, { q: "fixture-00" })).orders[0].profit, 40);
    assert.equal((await ordersForShop(context, period, { status: "COMPLETED" })).total, 31);
    const byProfit = await ordersForShop(context, period, { sort: "profit", dir: "asc" });
    assert.equal(byProfit.orders[0].status, "UNPAID"); assert.equal(byProfit.orders[1].profit, 40);
    const summary = await dashboardForShop(context, period);
    assert.equal(summary.metrics.orders, 31); assert.equal(summary.metrics.completed, 31);
    assert.equal(summary.metrics.profit, 30 * 70 + 40);
    assert.equal(summary.metrics.sales, 31 * 100.125);
    assert.equal(summary.orders.find(o => o.id === ids[0])?.cogs, 20.125);
    // A later refund restates the original checkout period, without double counting.
    await db.returnCase.create({ data: { shopId: shop.id, orderId: ids[0], returnSn: "refund", status: "ACCEPTED", confirmedRefund: "30.1250", sourceUpdatedAt: new Date() } });
    assert.equal((await dashboardForShop(context, period)).metrics.sales, 31 * 100.125 - 30.125);
    const version = context.reportVersion;
    await touchReportShop(shop.id);
    assert.notEqual((await reportShop(ownerId, "sandbox"))!.reportVersion, version);
  } finally {
    await db.returnCase.deleteMany({ where: { shopId: shop.id } });
    await db.financialSnapshot.deleteMany({ where: { order: { shopId: shop.id } } });
    await db.orderItem.deleteMany({ where: { order: { shopId: shop.id } } });
    await db.order.deleteMany({ where: { shopId: { in: [shop.id, foreign.id] } } });
    await db.skuCostVersion.deleteMany({ where: { variantId: variant.id } });
    await db.productVariant.delete({ where: { id: variant.id } });
    await db.shop.deleteMany({ where: { id: { in: [shop.id, foreign.id] } } });
    await db.user.delete({ where: { id: ownerId } });
    await closeDb();
  }
});
