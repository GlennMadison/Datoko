# Database usage operations

Datoko uses its existing Supabase PostgreSQL and Vercel deployment. No Redis,
replacement database, new scheduler, schema migration, or external service is required.

## Runtime behavior

- One dashboard controller checks a private status endpoint every two minutes
  while visible, or every 15 seconds during queued/running syncs. Hidden tabs
  cancel pending checks. Errors back off to a maximum of ten minutes.
- Unchanged status does not rerender reports. Returning to a tab checks once.
- Report data uses Next's Data Cache with a 60-second revalidation interval.
  Authentication and workspace lookup occur outside every cache scope; HTML
  remains dynamic through the layout's cookies/headers access.
- Cache identity includes owner, environment, shop, sync/connection version,
  selected dates, interval, report kind and filters. Current-time milliseconds
  are excluded so they do not defeat caching. A midnight WIB change refreshes
  date presets, including after returning to a hidden tab.
- Sync-state checkpoint/timestamp changes invalidate all affected date ranges by
  selecting a new version, including historical reports after refunds. Cost
  edits advance the shop version atomically with the edit. Manual ads imports
  also advance it. The report refresh button expires the authenticated owner's
  environment-scoped cache tag immediately, including after external corrections.
- Direct database edits without a version change are visible on cache revalidation
  or manual refresh. Read-only API report exports remain uncached.
- Product names, costs and settlements use SQL latest-per-group selection.
  Ads reads project only revision source metrics instead of entire payloads.
- Orders use SQL pagination, sorting and search. Their chart covers the whole
  filtered range, independent of the displayed page. Products/returns/settings
  have dedicated loaders, without fetching overview financial data.

## Background sync and connections

The one-minute scheduler remains in place so manual requests and resumable jobs
keep their existing latency. Actual order imports still respect the configured
sync interval. Worker summaries now include duration and an `empty` flag. Use
these to assess whether a future scheduler change is justified.

Session advisory locks protect jobs and rotating Shopee tokens. The production
connection release policy remains necessary while those locks use session
pooling. Do not switch the worker to transaction pooling without replacing
session locks with safe leases/transaction-compatible coordination.

## Measurements

Before/after statistics must use comparable traffic and time windows. Supabase's
Usage page reports database-pool traffic as **Shared Pooler Egress**. Record daily
bytes there; connection counts and query row counts are not byte measurements.
Past billed usage cannot be undone by this release.

Capture read-only query-counter snapshots with an explicitly loaded environment:

```powershell
node --env-file=.env.hosted.local --import tsx scripts/database-usage.ts
```

The script emits query IDs, categories, cumulative calls/rows and execution time,
with the statistics reset time. Compare counter deltas between two snapshots.
It does not print SQL text, provider credentials, or business identifiers.

For temporary report-cache diagnostics, set `DATABASE_USAGE_METRICS=true` in the
chosen runtime. Cache misses emit report kind, duration and serialized result
size. `resultBytes` measures the report result, not actual PostgreSQL wire bytes.
Keep this off during ordinary operation to avoid unnecessary log ingestion.

Read-only baseline, collected 1 November 2026 (WIB):

- Latest-product-name inputs: 780 historical item rows, 37 distinct variants.
  SQL now returns at most one name per variant instead of all historical items.
- Matching October ads revisions: 375 rows, 154,074 JSON bytes for full payloads
  versus 16,266 bytes for source metrics alone (about 89% less for that field).
  This is a sample query comparison, not a promised whole-app/monthly reduction.

Initial operating target: below roughly 120 MB/day of database egress at current
traffic, with correct financial totals and reliable sync. Review a full day of
usage after release before considering Redis, provider migration or paid capacity.

## Verification

Run unit tests and typecheck, build, database integration tests against a
dedicated test database, and the desktop/mobile browser suites. The usage
integration tests cover many historical settlement revisions, latest product
names, exact money, literal wildcard search, pagination and scoped reads.
Authenticated browser tests cover cross-request cache reuse, manual and sync
invalidation, private status responses, CSRF protection and hidden-tab polling.
