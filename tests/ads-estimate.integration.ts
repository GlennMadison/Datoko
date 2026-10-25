import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolveReportPeriod } from "../src/core/reporting-period.ts";
import type { AdsRow } from "../src/core/shopee-ads.ts";
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.toLowerCase().includes("test")) throw new Error("Use a dedicated TEST_DATABASE_URL containing 'test'.");
Object.assign(process.env, { DATABASE_URL: databaseUrl, DATOKO_MODE: "live", SHOPEE_ENV: "sandbox" });
const { getDb, closeDb } = await import("../src/server/db.ts");
const { importSyncedAdReport, advertisementForOwner } = await import("../src/server/ads.ts");

test("automatic estimates restate original-date cohorts with current owner-scoped payment and return evidence", async () => {
  const db = getDb(), ownerId = "estimate-" + randomUUID(), now = new Date();
  await db.user.create({ data: { id: ownerId, name: "Estimate owner", email: ownerId + "@example.test" } });
  const shop = await db.shop.create({ data: { ownerId, sourceShopId: String(Date.now()), environment: "sandbox", name: "Estimate shop" } });
  const variant = await db.productVariant.create({ data: { shopId: shop.id, sourceItemId: "1", sourceModelId: "0", name: "Product one" } });
  const other = await db.productVariant.create({ data: { shopId: shop.id, sourceItemId: "2", sourceModelId: "0", name: "Product two" } });
  const period = resolveReportPeriod({ preset: "custom", from: "2026-10-02", to: "2026-10-02", interval: "day" });
  const row: AdsRow = { campaignKey: "shop", campaignName: "Shop", grain: "DAY", start: "2026-10-01T17:00:00.000Z", end: "2026-10-02T17:00:00.000Z",
    spend: "100", revenue: "1000", sourceAsOf: now.toISOString(), attributionComplete: false, outcomesComplete: false, allocations: [],
    sourceMetrics: { directRevenue: "600" } };
  const ids: string[] = [];
  try {
    await db.shopConnection.create({ data: { shopId: shop.id } });
    for (const resource of ["orders", "returns"]) await db.syncState.create({ data: { shopId: shop.id, resource, coverageFrom: new Date("2026-09-01"), lastSuccessAt: now } });
    for (let index = 0; index < 10; index++) {
      const order = await db.order.create({ data: { shopId: shop.id, orderSn: "ESTIMATE-" + index, status: index < 8 ? "COMPLETED" : "UNPAID", paymentStatus: index < 8 ? "PAID" : "UNPAID",
        totalAmount: "110", merchandiseAmount: "100", sourceCreatedAt: new Date("2026-10-02T08:00:00Z"), sourceUpdatedAt: now,
        items: { create: { sourceLineKey: "line:1", variantId: index < 5 ? variant.id : other.id, name: "Immutable checkout product", quantity: 1, paidUnitPrice: "100", originalUnitPrice: "100" } } } });
      ids.push(order.id);
    }
    await importSyncedAdReport(shop, 1, [row], now);
    let data = await advertisementForOwner(ownerId, period);
    assert.equal(data.summary.originalRoas, "10.00"); assert.equal(data.summary.realRoas, null);
    assert.equal(data.estimate?.roas, "8.00"); assert.equal(data.estimate?.unpaidRevenue, "200.0000");
    assert.equal((await advertisementForOwner("outsider", period)).estimate, undefined);
    await db.order.update({ where: { id: ids[8] }, data: { status: "COMPLETED", paymentStatus: "PAID", sourceUpdatedAt: now } });
    assert.equal((await advertisementForOwner(ownerId, period)).estimate?.roas, "9.00");
    await db.order.update({ where: { id: ids[0] }, data: { status: "CANCELLED", sourceUpdatedAt: now } });
    await db.returnCase.create({ data: { shopId: shop.id, orderId: ids[1], returnSn: "ESTIMATE-RETURN", status: "ACCEPTED", confirmedRefund: "50", reportedAmount: "50", sourceUpdatedAt: now } });
    await db.financialSnapshot.create({ data: { orderId: ids[1], source: "SHOPEE_ESCROW", sourceKey: "test", hash: "test", revision: 1,
      amounts: { payout: "50", commission: "0", service: "0", transaction: "0", affiliate: "0", other: "0", refunds: "50", adjustment: "0" } } });
    data = await advertisementForOwner(ownerId, period);
    assert.equal(data.estimate?.roas, "7.50"); assert.equal(data.estimate?.refundedRevenue, "50.0000"); assert.equal(data.estimate?.storeRevenue, "750.0000");
    assert.equal(data.summary.originalRoas, "10.00"); assert.equal(data.points[0].estimated, 7.5);
    const campaign: AdsRow = { ...row, campaignKey: "campaign:1", campaignName: "Product one ad", spend: "60", revenue: "600", sourceMetrics: { directRevenue: "600", advertisedItemIds: ["1"] } };
    await importSyncedAdReport(shop, 1, [campaign], now);
    data = await advertisementForOwner(ownerId, period);
    assert.equal(data.estimate?.roas, "7.20"); assert.equal(data.estimate?.storeRoas, "7.50");
    assert.equal(data.campaigns.find(value => value.key === "campaign:1")?.estimatedRoas, "7.00");
    assert.equal((await advertisementForOwner(ownerId, period, { campaign: "campaign:1" })).estimate?.storeRoas, null);
    // A metric correction can return to a previously seen digest without a unique violation.
    const newer = new Date(now.getTime() + 60_000), newest = new Date(now.getTime() + 120_000);
    await importSyncedAdReport(shop, 1, [{ ...row, revenue: "900", sourceAsOf: newer.toISOString() }], newer);
    await importSyncedAdReport(shop, 1, [{ ...row, sourceAsOf: newest.toISOString() }], newest);
    assert.equal((await advertisementForOwner(ownerId, period)).summary.originalRoas, "10.00");
    await db.order.update({ where: { id: ids[2] }, data: { paymentStatus: "UNKNOWN" } });
    data = await advertisementForOwner(ownerId, period);
    assert.equal(data.estimate?.roas, null); assert.ok(data.estimate?.issues.includes("PAYMENT_OUTCOME_UNKNOWN"));
    await db.order.update({ where: { id: ids[2] }, data: { paymentStatus: "PAID" } });
    await db.syncState.update({ where: { shopId_resource: { shopId: shop.id, resource: "returns" } }, data: { lastErrorCode: "SHOPEE_PERMISSION_DENIED" } });
    assert.ok((await advertisementForOwner(ownerId, period)).estimate?.issues.includes("RETURN_SYNC_INCOMPLETE"));
    await db.syncState.update({ where: { shopId_resource: { shopId: shop.id, resource: "returns" } }, data: { lastErrorCode: null, lastSuccessAt: new Date(now.getTime() - 3_600_000) } });
    assert.ok((await advertisementForOwner(ownerId, period)).estimate?.issues.includes("OUTCOME_SYNC_STALE"));
    await db.syncState.update({ where: { shopId_resource: { shopId: shop.id, resource: "returns" } }, data: { lastSuccessAt: now, coverageFrom: new Date("2026-10-03") } });
    assert.ok((await advertisementForOwner(ownerId, period)).estimate?.issues.includes("RETURN_SYNC_INCOMPLETE"));
  } finally {
    await db.adReportBucket.deleteMany({ where: { dataset: { shopId: shop.id } } });
    await db.adDataset.deleteMany({ where: { shopId: shop.id } });
    await db.returnCase.deleteMany({ where: { shopId: shop.id } });
    await db.financialSnapshot.deleteMany({ where: { order: { shopId: shop.id } } });
    await db.orderItem.deleteMany({ where: { order: { shopId: shop.id } } });
    await db.order.deleteMany({ where: { shopId: shop.id } });
    await db.productVariant.deleteMany({ where: { shopId: shop.id } });
    await db.syncState.deleteMany({ where: { shopId: shop.id } });
    await db.shopConnection.deleteMany({ where: { shopId: shop.id } });
    await db.shop.delete({ where: { id: shop.id } });
    await db.user.delete({ where: { id: ownerId } });
    await closeDb();
  }
});
