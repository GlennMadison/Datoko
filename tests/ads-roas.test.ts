import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateRoas, attributionLineKey, ratioString, type AdAllocation, type AdSourceReport, type AttributionEvidence } from "../src/core/ads-roas.ts";
import { validateAdImport, readAdImportBody, MAX_AD_IMPORT_BYTES } from "../src/server/ads-import-schema.ts";

const now = new Date("2026-10-16T12:00:00Z");
function allocation(patch: Partial<AdAllocation> = {}): AdAllocation {
  return { key: "credit-1", orderSn: "ORDER-1", lineKey: "item:1", amount: "1000000", disposition: "RETAINED", confirmedRefund: "0", provisional: false, returnReferences: [], ...patch };
}
function report(patch: Partial<AdSourceReport> = {}): AdSourceReport {
  return { key: "report-1", start: "2026-10-14T17:00:00.000Z", end: "2026-10-15T17:00:00.000Z", grain: "DAY", spend: "100000", revenue: "1000000", sourceAsOf: "2026-10-16T10:00:00.000Z", attributionComplete: true, outcomesComplete: true, allocations: [allocation()], ...patch };
}
function evidence(patch: Partial<AttributionEvidence> = {}) {
  return new Map([[attributionLineKey("ORDER-1", "item:1"), { lineRevenue: "1000000", orderStatus: "COMPLETED", updatedAt: "2026-10-15T10:00:00.000Z", returns: [], ...patch }]]);
}
function calculate(reports: AdSourceReport[], proof = evidence()) { return calculateRoas(reports, proof, { requireEvidence: true, now }); }

test("Original 10.00x becomes Real 7.00x after a confirmed 300000 attributed refund", () => {
  const value = calculate([report({ allocations: [allocation({ confirmedRefund: "300000" })] })]);
  assert.equal(value.originalRoas, "10.00"); assert.equal(value.realRoas, "7.00");
  assert.equal(value.excludedRevenue, "300000.0000"); assert.equal(value.spend, "100000.0000");
});
test("cancellation plus later refund removes the credit exactly once", () => {
  const value = calculate([report({ allocations: [allocation({ disposition: "CANCELLED", confirmedRefund: "1000000" })] })]);
  assert.equal(value.realRoas, "0.00"); assert.equal(value.retainedRevenue, "0.0000"); assert.equal(value.excludedRevenue, "1000000.0000");
});
test("partial return and partial refund use disjoint entitlements", () => {
  const value = calculate([report({ revenue: "110000", spend: "20000", allocations: [
    allocation({ key: "unit-a", amount: "40000", disposition: "RETURNED", confirmedRefund: "40000" }),
    allocation({ key: "unit-b", amount: "70000" }),
  ] })]);
  assert.equal(value.originalRoas, "5.50"); assert.equal(value.realRoas, "3.50");
});
test("unrelated organic cancellations are never deducted", () => {
  const proof = evidence(); proof.set(attributionLineKey("ORGANIC", "item:2"), { lineRevenue: "999999", orderStatus: "CANCELLED", updatedAt: now.toISOString(), returns: [] });
  assert.equal(calculate([report()], proof).realRoas, "10.00");
});
test("late source cancellation restates the original advertising cohort", () => {
  const value = calculate([report()], evidence({ orderStatus: "CANCELLED", updatedAt: "2026-10-16T11:00:00.000Z" }));
  assert.equal(value.originalRoas, "10.00"); assert.equal(value.realRoas, "0.00");
});
test("ROAS uses ratio of sums rather than an average of ratios", () => {
  const value = calculateRoas([
    report({ spend: "100", revenue: "1000", allocations: [allocation({ amount: "1000" })] }),
    report({ key: "r2", start: "2026-10-13T17:00:00.000Z", end: "2026-10-14T17:00:00.000Z", spend: "900", revenue: "900", allocations: [allocation({ key: "c2", amount: "900" })] }),
  ], undefined, { now });
  assert.equal(value.originalRoas, "1.90"); assert.equal(value.realRoas, "1.90");
});
test("zero spend is unavailable, while zero revenue with spend is 0.00x", () => {
  assert.equal(calculate([report({ spend: "0" })]).realRoas, null);
  assert.equal(calculate([report({ revenue: "0", allocations: [] })]).realRoas, "0.00");
});
test("decimal calculations preserve integers beyond JavaScript's safe range and round once", () => {
  const value = calculateRoas([report({ revenue: "9007199254740993.0001", spend: "1", allocations: [allocation({ amount: "9007199254740993.0001", confirmedRefund: "0.0001" })] })], undefined, { now });
  assert.equal(value.retainedRevenue, "9007199254740993.0000");
  assert.equal(value.realRoas, "9007199254740993.00");
  assert.equal(ratioString(1004999n, 1000000n, 2), "1.00");
});
test("missing, stale, unbalanced, duplicated or over-credited evidence blocks adjusted totals", () => {
  const cases: [AdSourceReport[], Map<string, AttributionEvidence>, string][] = [
    [[report()], new Map(), "UNMATCHED_ATTRIBUTION"],
    [[report()], evidence({ updatedAt: "2026-10-16T11:00:00.000Z" }), "OUTCOMES_OUTDATED"],
    [[report()], evidence({ returns: [{ reference: "RETURN-1", updatedAt: "2026-10-15T12:00:00Z" }] }), "RETURN_COVERAGE_INCOMPLETE"],
    [[report({ revenue: "1100000" })], evidence(), "ATTRIBUTION_TOTAL_MISMATCH"],
    [[report({ allocations: [allocation({ amount: "500000" }), allocation({ amount: "500000" })] })], evidence(), "DUPLICATE_ATTRIBUTION"],
    [[report()], evidence({ lineRevenue: "999999" }), "CREDIT_EXCEEDS_ORDER_LINE"],
    [[report({ attributionComplete: false })], evidence(), "ATTRIBUTION_INCOMPLETE"],
    [[report({ outcomesComplete: false })], evidence(), "OUTCOME_COVERAGE_INCOMPLETE"],
  ];
  for (const [rows, proof, issue] of cases) {
    const result = calculate(rows, proof); assert.ok(result.issues.includes(issue), issue);
    assert.equal(result.realRoas, null, issue); assert.equal(result.retainedRevenue, null, issue);
    assert.ok(result.lines.every(line => line.retained === null), issue);
  }
});
test("current matching return evidence permits the confirmed adjustment", () => {
  const proof = evidence({ returns: [{ reference: "RETURN-1", updatedAt: "2026-10-15T12:00:00Z" }] });
  const result = calculate([report({ allocations: [allocation({ confirmedRefund: "300000", returnReferences: ["RETURN-1"] })] })], proof);
  assert.equal(result.realRoas, "7.00");
});
test("pending stored orders force the result to be provisional", () => {
  assert.equal(calculate([report()], evidence({ orderStatus: "READY_TO_SHIP" })).provisional, true);
});
test("credits outside the selected date range cannot conceal an over-credited item", () => {
  const proof = evidence({ creditedByScope: new Map([["shop:DAY", 1100000n * 10000n]]) });
  const result = calculateRoas([report()], proof, { requireEvidence: true, scopeKey: "shop:DAY", now });
  assert.equal(result.realRoas, null); assert.ok(result.issues.includes("CREDIT_EXCEEDS_ORDER_LINE"));
});
test("known refunds can reject contradictory outcomes without assigning organic or shipping refunds to ads", () => {
  const known = { orderBuyerTotal: "1120000", returns: [{ reference: "R1", updatedAt: "2026-10-15T10:00:00Z", confirmedRefund: "400000" }] };
  const row = report({ allocations: [allocation({ returnReferences: ["R1"] })] });
  const mismatch = calculate([row], evidence(known));
  assert.equal(mismatch.realRoas, null); assert.ok(mismatch.issues.includes("OUTCOME_TOTAL_MISMATCH"));
  assert.equal(calculate([row], evidence({ ...known, orderBuyerTotal: "2000000" })).realRoas, "10.00");
  row.allocations[0].confirmedRefund = "300000";
  assert.equal(calculate([row], evidence(known)).realRoas, "7.00");
});
test("negative inputs, excessive refunds and overlapping source periods are rejected", () => {
  assert.throws(() => calculate([report({ spend: "-1" })]), /NEGATIVE_ADS_AMOUNT/);
  assert.throws(() => calculate([report({ allocations: [allocation({ confirmedRefund: "1000001" })] })]), /INVALID_ADS_OUTCOME/);
  assert.throws(() => calculate([report(), report({ key: "overlap" })]), /OVERLAPPING_ADS_REPORTS/);
});

function importFile() {
  const { key: _key, ...row } = report();
  return { version: 1, sourceShopId: "1234", environment: "sandbox", datasetKey: "seller-export", datasetName: "Seller export", basis: "PLACED_TOTAL", reports: [{ ...row, campaignKey: "shop", campaignName: "Shop total" }] };
}
test("import validation rejects negative, unknown, unaligned and unreconciled input", () => {
  assert.equal(validateAdImport(importFile(), now).reports.length, 1);
  assert.throws(() => validateAdImport({ ...importFile(), ownerId: "forged" }, now), /INVALID_AD_REPORT/);
  for (const patch of [{ spend: "-1" }, { revenue: "1000001" }, { start: "2026-10-14T18:00:00Z" }, { sourceAsOf: "2099-01-01T00:00:00Z" }]) {
    const file = importFile(); Object.assign(file.reports[0], patch); assert.throws(() => validateAdImport(file, now));
  }
});
test("import rejects repeated source slots and repeated conversion keys", () => {
  const file = importFile(); file.reports.push(structuredClone(file.reports[0]));
  assert.throws(() => validateAdImport(file, now), /OVERLAPPING_ADS_REPORTS/);
  file.reports[1].start = "2026-10-13T17:00:00Z"; file.reports[1].end = "2026-10-14T17:00:00Z";
  assert.throws(() => validateAdImport(file, now), /DUPLICATE_ATTRIBUTION/);
});
test("aggregate-only input is accepted but cannot produce exact Real ROAS", () => {
  const file = importFile(); file.reports[0].attributionComplete = false; file.reports[0].outcomesComplete = false; file.reports[0].allocations = [];
  const row = validateAdImport(file, now).reports[0];
  const result = calculateRoas([{ ...row, key: "r" }]);
  assert.equal(result.originalRoas, "10.00"); assert.equal(result.realRoas, null);
});
test("equivalent decimal and timestamp formats normalize to identical source facts", () => {
  const first = importFile(), second = importFile();
  second.reports[0].spend = "00100000.0000"; second.reports[0].revenue = "1000000.00";
  second.reports[0].start = "2026-10-15T00:00:00+07:00";
  assert.deepEqual(validateAdImport(first, now), validateAdImport(second, now));
});
test("request reader enforces JSON and bounded content even without Content-Length", async () => {
  await assert.rejects(readAdImportBody(new Request("http://localhost", { method: "POST", body: "{}" })), /JSON_REQUIRED/);
  await assert.rejects(readAdImportBody(new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(MAX_AD_IMPORT_BYTES + 1) })), /ADS_IMPORT_TOO_LARGE/);
  assert.deepEqual(await readAdImportBody(new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })), {});
});

test("stored unpaid orders cannot count as retained exact advertising revenue", () => {
  const value = calculate([report()], evidence({ paymentStatus: "UNPAID" }));
  assert.equal(value.originalRoas, "10.00"); assert.equal(value.realRoas, "0.00");
  assert.equal(value.lines[0].outcome, "UNPAID");
  const unknown = calculate([report()], evidence({ paymentStatus: "UNKNOWN" }));
  assert.equal(unknown.realRoas, null); assert.ok(unknown.issues.includes("PAYMENT_OUTCOME_UNKNOWN"));
});
