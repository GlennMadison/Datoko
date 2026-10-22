import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveReportPeriod, createTimeBuckets, dayStart, pageReportPeriod, periodContains } from "../src/core/reporting-period.ts";
import { activityTrend } from "../src/server/reporting.ts";
const now = new Date("2026-10-16T12:00:00Z");

test("Today uses WIB midnight and excludes future hours", () => {
  const period = resolveReportPeriod({ preset: "today" }, now);
  assert.equal(period.fromISO, "2026-10-15T17:00:00.000Z");
  assert.equal(period.toISO, "2026-10-16T17:00:00.000Z");
  assert.equal(createTimeBuckets(period).length, 24);
  assert.equal(createTimeBuckets(period).filter(bucket => !bucket.future).length, 19);
  assert.equal(periodContains(period, "2026-10-15T16:59:59Z"), false);
  assert.equal(periodContains(period, period.effectiveToISO), false);
});
test("WIB date rolls over at 17:00 UTC", () => {
  assert.equal(resolveReportPeriod({ preset: "today" }, new Date("2026-10-16T16:59:59Z")).from, "2026-10-16");
  assert.equal(resolveReportPeriod({ preset: "today" }, new Date("2026-10-16T17:00:00Z")).from, "2026-10-17");
});
test("month week buttons include month end and leap day", () => {
  const october = resolveReportPeriod({ preset: "month-week", year: "2025", month: "10", week: "4" }, now);
  assert.equal(october.from, "2025-10-22"); assert.equal(october.to, "2025-10-31");
  const february = resolveReportPeriod({ preset: "month-week", year: "2024", month: "2", week: "4" }, now);
  assert.equal(february.from, "2024-02-22"); assert.equal(february.to, "2024-02-29");
});
test("weekly graphs start on Monday and clip partial edges", () => {
  const period = resolveReportPeriod({ preset: "custom", from: "2026-10-01", to: "2026-10-16", interval: "week" }, now);
  const buckets = createTimeBuckets(period);
  assert.equal(buckets[0].start, "2026-09-30T17:00:00.000Z");
  assert.equal(buckets[0].end, "2026-10-04T17:00:00.000Z");
  assert.equal(buckets.at(-1)?.end, period.toISO);
});
test("hour increments group by WIB clock and retain future gaps", () => {
  for (const [interval, expected] of [["hour", 24], ["3hour", 8], ["6hour", 4], ["12hour", 2]] as const) {
    const period = resolveReportPeriod({ preset: "today", interval }, now);
    assert.equal(createTimeBuckets(period).length, expected);
  }
});
test("invalid dates, future weeks, repeated filters and excessive chart resolution fail explicitly", () => {
  assert.throws(() => dayStart("2026-02-30"));
  for (const query of [
    { preset: "month-week", year: "2026", month: "10", week: "4" },
    { preset: "custom", from: "2026-10-16", to: "2026-10-15" },
    { preset: ["today", "last30"] }, { interval: "second" }, { tz: "UTC" },
    { preset: "last90", interval: "hour" },
  ]) assert.throws(() => resolveReportPeriod(query, now));
  assert.ok(pageReportPeriod({ preset: "invalid" }, now).error);
});
test("legacy date URLs remain compatible and auto groups long ranges", () => {
  assert.equal(resolveReportPeriod({ days: "7" }, now).preset, "last7");
  const period = resolveReportPeriod({ preset: "custom", from: "2025-01-01", to: "2026-10-16" }, now);
  assert.equal(period.effectiveInterval, "month");
});
test("activity charts sum exactly once and preserve null future buckets", () => {
  const period = resolveReportPeriod({ preset: "today", interval: "6hour" }, now);
  const rows = [{ createdAt: "2026-10-15T18:00:00Z", status: "COMPLETED", merchandise: "0.1", quantity: 2 },
    { createdAt: "2026-10-15T19:00:00Z", status: "COMPLETED", merchandise: "0.2", quantity: 1 },
    { createdAt: "2026-10-15T20:00:00Z", status: "CANCELLED", merchandise: "100", quantity: 1 }];
  const points = activityTrend(period, rows);
  assert.equal(points[0].sales, 0.3); assert.equal(points[0].orders, 3); assert.equal(points[0].units, 3);
  assert.equal(activityTrend(resolveReportPeriod({ preset: "today" }, now), rows).at(-1)?.sales, null);
});
