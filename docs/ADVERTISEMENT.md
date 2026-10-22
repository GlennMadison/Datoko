# Advertisement and reporting periods

The Advertisement page compares the source report's original attributed revenue / spend with the retained attributed revenue / the same spend. Money uses integer units at four decimal places. ROAS is rounded once to two decimal places, after summing revenue and spend. Zero spend produces Unavailable, including when revenue is also zero.

For example, Rp1,000,000 of source revenue and Rp100,000 of advertising spend give Original ROAS **10.00x**. A confirmed Rp300,000 loss gives retained revenue Rp700,000 and Real ROAS **7.00x**. Organic cancellations do not enter this calculation.

## Source availability

This connection does not yet have a verified automatic Shopee Ads attribution adapter. Use the owner-only normalized JSON import. It is an input format, not a claim that Shopee exports this exact JSON. Transform the source advertising report into this format while preserving its attribution window, revenue basis, timestamps, and conversion identities. If the provider exposes only aggregate metrics, import those with completeness false: Original ROAS is available, while Real ROAS stays unavailable.

Uploads are explicitly labeled Imported source reports. The server can validate arithmetic, identities, stored orders, known return evidence, and freshness. It cannot establish the truth or completeness of an uploaded source report. Set completeness true only when the underlying source supports it. Reimport updated outcomes when late returns or other order updates occur.

## Import format

Download the format from Advertisement. Download order item references for the selected order-date range to find the stored `orderSn` and `lineKey` values. References do not establish advertising attribution. For old conversions, choose the original order dates when exporting references. Only the owner can download them; buyer personal details, tokens, and costs are excluded.

An illustrative report:

```json
{
  "version": 1,
  "sourceShopId": "123456",
  "environment": "sandbox",
  "datasetKey": "shopee-total-placed",
  "datasetName": "Shopee total placed revenue",
  "basis": "PLACED_TOTAL",
  "reports": [{
    "campaignKey": "shop",
    "campaignName": "Shop total",
    "grain": "DAY",
    "start": "2026-10-01T00:00:00+07:00",
    "end": "2026-10-02T00:00:00+07:00",
    "sourceAsOf": "2026-10-03T10:00:00Z",
    "spend": "100000",
    "revenue": "1000000",
    "attributionComplete": true,
    "outcomesComplete": true,
    "allocations": [{
      "key": "conversion-123-item-1",
      "orderSn": "EXAMPLE-ORDER",
      "lineKey": "line:987654",
      "amount": "1000000",
      "disposition": "RETAINED",
      "confirmedRefund": "300000",
      "provisional": false,
      "returnReferences": ["EXAMPLE-RETURN"]
    }]
  }]
}
```

Replace every example identity and amount with supported source facts. JSON money values must be strings, nonnegative, with at most four decimal places. `environment` is sandbox or production and must match the active shop. The dataset key identifies one consistent source and attribution basis:

| Basis | Revenue definition |
| --- | --- |
| PLACED_TOTAL | All source-attributed placed revenue |
| PLACED_DIRECT | Directly attributed placed revenue |
| CONFIRMED_TOTAL | All source-attributed confirmed revenue |
| CONFIRMED_DIRECT | Directly attributed confirmed revenue |

Do not compare or combine different bases as if they were equivalent. Use a separate dataset key for a different attribution window, source definition, or currency. The current application supports this shop's IDR merchandise values. A dataset's basis cannot be changed after import. Original ROAS is recomputed from the original source revenue and spend; source UI rounding can differ.

`campaignKey: "shop"` is the canonical shop-wide report. Other keys identify individual campaign scopes. Shop totals are never summed with campaign totals, and overlapping campaign attribution is not used to synthesize a shop total.

`grain` is DAY (one midnight-aligned WIB day) or HOUR (one aligned hour). Start is inclusive; end is exclusive. Include explicit zero rows for source periods known to contain zero activity. Missing periods produce gaps and block an exact Real ROAS for the selected range. Daily source totals cannot produce an hourly graph. Auto selects Daily when only daily data exists. Hourly and daily reports for the same scope are alternative representations; the dashboard chooses one grain and never adds both.

## Partial outcomes and reconciliation

Each allocation is a **disjoint revenue entitlement** credited by the source. Its key is stable and unique across reporting periods in that dataset, campaign, and grain. Split an item into separate allocations when only some units are cancelled or returned. Their amounts must reconcile to the source credit, and their combined credit cannot exceed the matched item's paid merchandise value. A price-definition mismatch causes Unavailable, not an inferred adjustment.

| Disposition | Retained revenue |
| --- | --- |
| RETAINED | Allocated amount minus its confirmed refund |
| CANCELLED | Zero |
| RETURNED | Zero |

A refund after cancellation or return does not remove revenue twice. A return request alone is not a confirmed loss. Assign partial refunds only to the credited revenue entitlement they actually affect; exclude shipping refunds and unrelated items. Do not apply an order's entire refund separately to every item. Full confirmed returns use RETURNED; split partial returns into retained and returned entitlements.

Exact Real ROAS requires complete attribution, exact reconciliation to source revenue, complete outcomes, matching owner/shop/order/line identities, current known order/return evidence, and full selected-period source coverage. All known return references for the credited order must be present and no newer than the source snapshot. New non-cancellation order updates invalidate stale outcomes. A currently stored full cancellation immediately makes its attributed entitlements zero. Pending orders and unfinished source periods are labeled provisional. Later source revisions restate the original advertising bucket.

Known confirmed order refunds also provide a conservative contradiction check: imported retained credits cannot exceed what could remain after those refunds, even after allowing for shipping and other items. This check rejects inconsistent evidence; it never assigns an organic or shipping refund to advertising.

## Dates and charts

All five analytics pages use the same URL-driven controls and WIB timezone. Date selection reloads the report automatically. Custom dates debounce for 300 ms once valid. Invalid ranges show a message and keep the current report. Direct invalid date URLs display an explicit fallback message; the JSON report API rejects them with 400.

Today, Yesterday, This week, This month, Last 7/30/90 days, reporting year, Jan-Dec, and Week 1-4 are supported. The Date range button opens a two-panel picker with quick ranges on the left and day, month-week, month, year, or custom choices on the right. Calendar browsing does not change the report until a date, week, month, or year is selected; valid custom edits update automatically. Year selections use January 1 through December 31, capped at today for the current year. Date range and Interval share one toolbar directly above each graph, below summary cards where present. The picker supports keyboard activation, Escape, and outside-click dismissal. Month weeks are 1-7, 8-14, 15-21, and 22-month end. Calendar weeks start Monday. Current ranges end at now; future graph buckets remain null. Today and other relative periods refresh once a minute. Intervals are Auto, 1/3/6/12 hours, Daily, Weekly, and Monthly. Large ranges require coarser intervals (at most 1,000 points).

Advertising dates identify source attribution cohorts. Order/product/overview trends use order creation dates and current stored order status. Returns use the latest source case update, not settlement date. Complete automated return and settlement ingestion is still unavailable.

## Security and rollout

The import requires a real owner session and an exact same-origin POST. Shop and environment checks run on the server. JSON input is strict and bounded to 2 MiB, 200 rows, 2,000 allocations per row, and 10,000 allocations per file. Report reads are private and uncached. Reports never change Shopee campaigns, tokens, order records, or costs.

Imports are atomic, serialized per source dataset, and idempotent, including equivalent decimal and timestamp representations. Conflicting older or equal-timestamp revisions are rejected; newer revisions retain the earlier payload and importing owner in an audit table. Cross-period duplicate entitlement keys are rejected. Excess credits for selected items are checked across other dates in the same source scope. Reporting reads use a consistent read-only snapshot and cap record counts explicitly instead of silently truncating calculations.

Apply the additive migration before using this page against an existing database:

```powershell
npm run db:deploy
```

It adds four advertising tables, indexes, foreign keys, and financial/time constraints. It does not delete or rewrite existing records. Database sessions explicitly use UTC for Prisma timestamp compatibility; WIB conversion occurs in reporting. Tests require a separate TEST_DATABASE_URL whose database name contains test. Browser test servers bind to 127.0.0.1 and shut down through a parent-only IPC channel; production still uses the normal Next server.
