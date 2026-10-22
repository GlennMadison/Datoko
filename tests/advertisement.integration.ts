import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolveReportPeriod } from "../src/core/reporting-period.ts";
import type { AdImport } from "../src/server/ads-import-schema.ts";
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.toLowerCase().includes("test")) throw new Error("Use a dedicated TEST_DATABASE_URL containing 'test'.");
Object.assign(process.env, { DATABASE_URL: databaseUrl, DATOKO_MODE: "live", SHOPEE_ENV: "sandbox" });
const { getDb, closeDb } = await import("../src/server/db.ts");
const { importAdReport, advertisementForOwner, buildAdvertisementData } = await import("../src/server/ads.ts");

test("private attributed reports survive revisions and reconcile to actual stored orders", async t => {
  const db = getDb(), ownerId = `ads-${randomUUID()}`, sourceShopId = String(Date.now());
  await db.user.create({ data: { id: ownerId, name: "Ads owner", email: `${ownerId}@example.test` } });
  const shop = await db.shop.create({ data: { ownerId, sourceShopId, environment: "sandbox", name: "Ads test shop" } });
  const variant = await db.productVariant.create({ data: { shopId: shop.id, sourceItemId: "1", sourceModelId: "0", name: "Test product", sku: "ADS-TEST" } });
  const order = await db.order.create({ data: { shopId: shop.id, orderSn: "ADS-ORDER", status: "COMPLETED", totalAmount: "1120000", merchandiseAmount: "1000000", sourceCreatedAt: new Date("2026-10-01T08:00:00Z"), sourceUpdatedAt: new Date("2026-10-01T09:00:00Z"), items: { create: { sourceLineKey: "line:1", variantId: variant.id, name: "Test product", quantity: 2, paidUnitPrice: "500000", originalUnitPrice: "500000" } } } });
  const period = resolveReportPeriod({ preset: "custom", from: "2026-10-01", to: "2026-10-01", interval: "day" });
  function input(): AdImport { return {
    version: 1, sourceShopId, environment: "sandbox", datasetKey: "source-test", datasetName: "Test report", basis: "PLACED_TOTAL",
    reports: [{ campaignKey: "shop", campaignName: "Shop total", grain: "DAY", start: "2026-09-30T17:00:00.000Z", end: "2026-10-01T17:00:00.000Z", spend: "100000", revenue: "1000000", sourceAsOf: "2026-10-02T10:00:00.000Z", attributionComplete: true, outcomesComplete: true,
      allocations: [{ key: "credited-item-1", orderSn: "ADS-ORDER", lineKey: "line:1", amount: "1000000", disposition: "RETAINED", confirmedRefund: "300000", provisional: false, returnReferences: [] }] }],
  }; }
  try {
    await t.test("timestamps round trip unchanged even when the host database defaults to WIB", async () => {
      assert.equal(order.sourceCreatedAt.toISOString(), "2026-10-01T08:00:00.000Z");
      const rows = await db.$queryRaw<{ zone: string }[]>`SELECT current_setting('TimeZone') AS zone`;
      assert.equal(rows[0].zone, "UTC");
    });
    await t.test("another owner and environment cannot import into this shop", async () => {
      await assert.rejects(importAdReport("outsider", input()), /SHOP_NOT_FOUND/);
      await assert.rejects(importAdReport(ownerId, { ...input(), environment: "production" }), /WRONG_ADS_ENVIRONMENT/);
      assert.equal(await db.adDataset.count({ where: { shopId: shop.id } }), 0);
    });
    await t.test("retry is idempotent and original source values stay separate", async () => {
      assert.equal((await importAdReport(ownerId, input())).imported, 1);
      assert.equal((await importAdReport(ownerId, input())).unchanged, 1);
      const equivalent = input(); equivalent.reports[0].spend = "100000.0000";
      assert.equal((await importAdReport(ownerId, equivalent)).unchanged, 1);
      const value = await advertisementForOwner(ownerId, period);
      assert.equal(value.summary.originalRoas, "10.00"); assert.equal(value.summary.realRoas, "7.00");
      assert.equal(value.summary.spend, "100000.0000");
      assert.equal(await db.adReportRevision.count({ where: { report: { dataset: { shopId: shop.id } } } }), 1);
      assert.equal((await advertisementForOwner("outsider", period)).datasetKey, null);
    });
    await t.test("stale conflicting revisions roll back the entire file", async () => {
      const file = input(); file.datasetName = "Must roll back";
      file.reports.unshift({ ...structuredClone(file.reports[0]), start: "2026-09-29T17:00:00.000Z", end: "2026-09-30T17:00:00.000Z", revenue: "0", allocations: [] });
      file.reports[1].spend = "99999";
      await assert.rejects(importAdReport(ownerId, file), /STALE_ADS_REVISION/);
      const dataset = await db.adDataset.findFirstOrThrow({ where: { shopId: shop.id } });
      assert.equal(dataset.name, "Test report");
      assert.equal(await db.adReportBucket.count({ where: { datasetId: dataset.id } }), 1);
    });
    await t.test("duplicate credits in a separate import cannot leak across selected periods", async () => {
      const file = input(); file.reports[0].start = "2026-09-29T17:00:00.000Z"; file.reports[0].end = "2026-09-30T17:00:00.000Z";
      await assert.rejects(importAdReport(ownerId, file), /DUPLICATE_ATTRIBUTION/);
    });
    await t.test("attribution basis is immutable for each source dataset", async () => {
      await assert.rejects(importAdReport(ownerId, { ...input(), basis: "CONFIRMED_TOTAL" }), /ADS_BASIS_CHANGED/);
    });
    await t.test("a new revision changes the historic cohort once and preserves an audit trail", async () => {
      const file = input(); file.reports[0].sourceAsOf = "2026-10-03T10:00:00.000Z"; file.reports[0].allocations[0].confirmedRefund = "400000";
      assert.equal((await importAdReport(ownerId, file)).imported, 1);
      const value = await advertisementForOwner(ownerId, period);
      assert.equal(value.summary.originalRoas, "10.00"); assert.equal(value.summary.realRoas, "6.00");
      assert.equal(await db.adReportRevision.count({ where: { report: { dataset: { shopId: shop.id } } } }), 2);
    });
    await t.test("a newly discovered return blocks stale Real ROAS until updated outcome evidence arrives", async () => {
      await db.returnCase.create({ data: { shopId: shop.id, orderId: order.id, returnSn: "ADS-RETURN", status: "RESOLVED", confirmedRefund: "400000", sourceUpdatedAt: new Date("2026-10-04T08:00:00Z") } });
      assert.equal((await advertisementForOwner(ownerId, period)).summary.realRoas, null);
      const file = input(); file.reports[0].sourceAsOf = "2026-10-04T10:00:00.000Z"; file.reports[0].allocations[0].confirmedRefund = "400000"; file.reports[0].allocations[0].returnReferences = ["ADS-RETURN"];
      await importAdReport(ownerId, file);
      assert.equal((await advertisementForOwner(ownerId, period)).summary.realRoas, "6.00");
      await db.order.update({ where: { id: order.id }, data: { status: "CANCELLED", sourceUpdatedAt: new Date("2026-10-05T10:00:00Z") } });
      const value = await advertisementForOwner(ownerId, period);
      assert.equal(value.summary.realRoas, "0.00"); assert.equal(value.summary.excludedRevenue, "1000000.0000");
    });
    await t.test("missing source periods and unsupported hourly grain remain explicit", async () => {
      const longer = resolveReportPeriod({ preset: "custom", from: "2026-10-01", to: "2026-10-02", interval: "day" });
      const gaps = await advertisementForOwner(ownerId, longer);
      assert.equal(gaps.summary.realRoas, null); assert.ok(gaps.summary.issues.includes("PERIOD_COVERAGE_INCOMPLETE"));
      assert.equal(gaps.points[1].original, null);
      const hourly = await advertisementForOwner(ownerId, { ...period, interval: "hour", effectiveInterval: "hour" });
      assert.ok(hourly.chartUnavailable); assert.ok(hourly.points.every(point => point.original === null));
      const auto = await advertisementForOwner(ownerId, { ...period, interval: "auto", effectiveInterval: "hour" });
      assert.equal(auto.period.effectiveInterval, "day");
    });
    await t.test("the database rejects negative money independently of the API", async () => {
      const row = await db.adReportBucket.findFirstOrThrow({ where: { dataset: { shopId: shop.id } } });
      await assert.rejects(db.adReportBucket.update({ where: { id: row.id }, data: { spend: "-1" } }));
      assert.equal((await db.adReportBucket.findUniqueOrThrow({ where: { id: row.id } })).spend.toString(), "100000");
    });
    await t.test("an excess credit outside the selected day invalidates that item's Real ROAS", async () => {
      const file = input(); file.reports[0].start = "2026-09-29T17:00:00.000Z"; file.reports[0].end = "2026-09-30T17:00:00.000Z";
      file.reports[0].revenue = "100000"; file.reports[0].allocations[0].key = "different-entitlement";
      file.reports[0].allocations[0].amount = "100000"; file.reports[0].allocations[0].confirmedRefund = "0";
      await importAdReport(ownerId, file);
      const value = await advertisementForOwner(ownerId, period);
      assert.equal(value.summary.realRoas, null); assert.ok(value.summary.issues.includes("CREDIT_EXCEEDS_ORDER_LINE"));
      assert.equal(value.points[0].real, null);
    });
    await t.test("no campaign fallback can substitute another campaign's metrics", () => {
      const value = buildAdvertisementData(period, [], new Map(), [], null, "missing");
      assert.equal(value.campaignKey, "missing"); assert.equal(value.summary.realRoas, null);
    });
  } finally {
    await db.adReportBucket.deleteMany({ where: { dataset: { shopId: shop.id } } });
    await db.adDataset.deleteMany({ where: { shopId: shop.id } });
    await db.returnCase.deleteMany({ where: { shopId: shop.id } });
    await db.orderItem.deleteMany({ where: { orderId: order.id } });
    await db.order.delete({ where: { id: order.id } });
    await db.productVariant.delete({ where: { id: variant.id } });
    await db.shop.delete({ where: { id: shop.id } });
    await db.user.delete({ where: { id: ownerId } });
    await closeDb();
  }
});
