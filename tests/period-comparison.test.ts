import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveReportPeriod } from "../src/core/reporting-period.ts";
import { overviewComparisonPeriod } from "../src/core/period-comparison.ts";
import { percentChange } from "../src/core/metric-comparison.ts";

const now = new Date("2026-10-28T08:00:00Z");
test("presets compare with the preceding period and custom ranges never compare", () => {
  for (const [query, from, to] of [
    [{ preset: "today" }, "2026-10-27", "2026-10-27"],
    [{ preset: "yesterday" }, "2026-10-26", "2026-10-26"],
    [{ preset: "this-week" }, "2026-10-19", "2026-10-21"],
    [{ preset: "this-month" }, "2026-09-01", "2026-09-28"],
    [{ preset: "last7" }, "2026-10-15", "2026-10-21"],
    [{ preset: "last30" }, "2026-08-30", "2026-09-28"],
    [{ preset: "last90" }, "2026-05-02", "2026-07-30"],
    [{ preset: "month", year: "2026", month: "4" }, "2026-03-01", "2026-03-31"],
    [{ preset: "month-week", year: "2026", month: "4", week: "4" }, "2026-04-15", "2026-04-21"],
    [{ preset: "day", from: "2024-03-01" }, "2024-02-29", "2024-02-29"],
    [{ preset: "year", year: "2024" }, "2023-01-01", "2023-12-31"],
  ] as const) {
    const previous = overviewComparisonPeriod(resolveReportPeriod(query, now));
    assert.equal(previous?.from, from, JSON.stringify(query));
    assert.equal(previous?.to, to, JSON.stringify(query));
  }
  for (const [from, to] of [["2024-02-01", "2024-02-29"], ["2024-02-29", "2024-02-29"], ["2024-01-01", "2024-12-31"]]) {
    assert.equal(overviewComparisonPeriod(resolveReportPeriod({ preset: "custom", from, to }, now)), null);
  }
});
test("comparison cutoffs match local time and completed shorter months include all previous days", () => {
  assert.equal(overviewComparisonPeriod(resolveReportPeriod({ preset: "today" }, now))?.effectiveToISO, "2026-10-27T08:00:00.000Z");
  const april = overviewComparisonPeriod(resolveReportPeriod({ preset: "month", year: "2026", month: "4" }, now));
  assert.equal(april?.effectiveToISO, april?.toISO);
  assert.equal(overviewComparisonPeriod(resolveReportPeriod({ preset: "day", from: "2000-01-01" }, now)), null);
});
test("percentages support losses and withhold zero or missing baselines", () => {
  assert.equal(percentChange(150, 100), 50);
  assert.equal(percentChange(0, 100), -100);
  assert.equal(percentChange(-50, -100), 50);
  assert.equal(percentChange(0, 0), 0);
  assert.equal(percentChange(100, 0), null);
  assert.equal(percentChange(null, 100), null);
  assert.equal(percentChange(100, null), null);
});
