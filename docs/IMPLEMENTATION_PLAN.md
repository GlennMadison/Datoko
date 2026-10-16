# Solidum Shopee Dashboard — Implementation Plan

Prepared: 15 October 2026
Status: implementation-ready design; credentials and Shopee app approval are not yet verified.
Project inspection: the current workspace is empty.

## 1. Outcome and scope

Build a private dashboard for Solidum's Indonesian Shopee shop. PostgreSQL keeps durable business records; a background worker updates them even when the browser is closed.

The first release will provide:

- Google sign-in restricted to the owner's verified account.
- Connect, reconnect, and disconnect Shopee, including the complete authorization redirect and callback.
- Orders, products/variants, cancellations, returns, refunds, and available settlement/fee data.
- Manual SKU costs with a historical cost snapshot for each order line.
- Revenue, order status, product rankings, and estimated contribution profit.
- A sync dashboard showing resource-specific freshness, coverage, failures, and retry progress.
- Automatic sync every 10 minutes, an immediate queued "Sync now" action, and nightly reconciliation.

Assumptions: one owner, one Indonesian shop, IDR, and Asia/Jakarta as the reporting timezone. Every business record still carries shop_id so a second shop does not require redesigning the database.

Advertising/ROAS, automatic packing, buyer messaging, inventory writeback, and accounting/tax filing are later features. This release reads Shopee business data and changes only local costs/settings. Verify advertising access separately before promising API-backed ROAS.

## 2. Technical decisions

| Part | Decision | Reason |
| --- | --- | --- |
| Application | Next.js App Router + TypeScript, Node runtime | Pages and backend routes in one repository |
| UI | Tailwind CSS + shadcn/ui | Reusable tables, filters, forms, and status components |
| Charts | Recharts | Sales, refunds, and order trends |
| Storage | PostgreSQL + Prisma | Durable relational records and migrations |
| Dashboard login | Better Auth + Google, database sessions | Owner authentication kept separate from shop authorization |
| Background processing | Separate TypeScript process + pg-boss | PostgreSQL-backed durable jobs, schedules, retries, and manual runs |
| API input validation | Zod | Validate environment variables, requests, and source payloads |
| Tests | Vitest, real test PostgreSQL, Playwright | Signing/mapping, transaction/retry behavior, and browser redirects |
| Hosting | Railway web service + worker service + PostgreSQL | Three deployable services from the same source repository |

Use a supported, mutually compatible dependency set and commit its lockfile. Starting compatibility target: Node 24 and Prisma 7 with its PostgreSQL driver adapter. Prisma's current Better Auth guide explicitly targets Prisma 7; confirm adapter compatibility before selecting another major version. This is a compatibility choice, not a requirement to use an outdated patch.

The web service renders SQL data and accepts commands. The worker owns Shopee calls for data imports, scheduled updates, reconciliation, and refreshes. The short authorization-code exchange runs in the callback handler so a successful connection can be persisted before returning to the UI.

pg-boss jobs live in the same PostgreSQL database in their own schema. Use its tested transaction adapter to save a connection and enqueue its initial import in one SQL transaction. External API calls remain retryable operations requiring application-level deduplication; a queue does not make them exactly once.

Run the worker continuously so manual jobs can begin promptly. Do not implement scheduled work using browser timers or unawaited work after a web response. The scheduler is part of the worker, rather than a second Railway cron schedule.

## 3. Shopee access and contract checkpoint

Complete this checkpoint before building the full reporting UI:

1. Confirm the available Shopee app type supports this own-shop integration in Indonesia.
2. Obtain sandbox and production partner credentials separately, plus the authorized shop ID.
3. Verify approved permissions for shop identity, order lists/details, product/variant data, returns, and payment/settlement data.
4. Configure a stable HTTPS staging address and its callback in the Shopee portal. Register the production address separately. Do not assume localhost or changing preview domains are accepted.
5. Prove authorization, callback correlation, code exchange, one identity request, and one order-details request in the sandbox.
6. Record actual endpoint pagination, maximum date-window sizes, queryable history, rate limits, timestamp precision, request-signing rules, and regional hosts in a versioned API contract note.
7. Check whether each payment endpoint is available to local Indonesian sellers. In particular, the payout-details endpoint is documented for cross-border sellers; do not design this local shop around it.
8. Record permitted storage/retention and minimize buyer personal information. Permanent business history does not require retaining buyer addresses.

If production app review requires a working website, prepare a small branded app shell with a product explanation, contact/privacy pages, login, and explicitly labeled demo data while approval is pending. Replace demo mode only after a real authorization succeeds.

**Evidence limitation:** official Shopee search excerpts were retrievable, but full documentation pages returned HTTP 403 during this planning session. The endpoint paths and indexed fields below have official references. Exact callback matching, nonce transport, limits, error payloads, and app-specific permissions remain sandbox/portal verification gates.

## 4. Authorization and redirect implementation

Google login authenticates the dashboard owner. Shopee authorization grants access to the shop. They use different callbacks and separate state.

### Callback addresses

Use an environment-specific APP_BASE_URL configured on the server. These are illustrative addresses, not existing deployments:

| Purpose | Address |
| --- | --- |
| Dashboard sign-in callback | https://dashboard.example.com/api/auth/callback/google |
| Shopee shop callback | https://dashboard.example.com/api/integrations/shopee/callback |
| Successful return | https://dashboard.example.com/settings/integrations?connection=connected |
| Failed/expired return | https://dashboard.example.com/settings/integrations?connection=failed |

Never derive the external callback origin from an arbitrary Host header. Never accept an unrestricted returnTo URL. Store an allowlisted relative return path on the authorization attempt.

### Required flow

1. **Start:** the owner clicks "Connect Shopee". POST /api/integrations/shopee/connect verifies the owner session, request origin/CSRF protection, allowed environment, and configured shop allowlist.
2. **Bind the attempt:** create an auth_attempts row containing a cryptographically random nonce hash, owner ID, initiating session binding, environment, expected shop ID, allowlisted return path, and an application-defined 10-minute expiry. Set a Secure, HttpOnly, SameSite=Lax browser cookie binding this attempt. Permit only one active attempt per session.
3. **Build the Shopee URL on the server:** sign the shop authorization request with HMAC-SHA256 using the partner key and the documented signature base. Build the query with URL utilities so the callback is encoded correctly. Redirect the browser to Shopee's /api/v2/shop/auth_partner endpoint using a 303 response from the POST.
   Use a native form POST so the response performs a full browser navigation. If the UI starts this with fetch instead, return the signed URL as JSON and explicitly navigate with window.location.assign; a cross-origin fetch redirect does not navigate the dashboard.
4. **Seller approval:** Shopee presents its login/consent screens and returns to our callback with a code and shop context. This release supports shop authorization; reject merchant/main-account flows until separately implemented.
5. **Validate the callback:** the callback handler checks the existing owner session, attempt cookie, nonce round trip, expiry, environment, and expected shop. Validate code shape and parse external identifiers without unsafe JavaScript integer conversion. Claim the attempt atomically before exchanging the code.
6. **Exchange on the server:** call POST /api/v2/auth/token/get with the validated code and shop ID, using the documented public-endpoint signature. Obtain shop identity through an authenticated API request and verify it matches the expected/allowed shop. Do not trust callback shop_id alone as proof of authorization.
7. **Persist atomically:** encrypt the tokens, store response-derived expiry times and a connection generation, mark the attempt successful, and enqueue the initial import in the same database transaction.
8. **Return cleanly:** clear the attempt cookie and issue a 303 redirect to the saved settings path with a nonsecret status flag. Show "Connected — importing orders" and poll local job status.
9. **Import in the background:** the worker imports the initial data, updates coverage/freshness, and the dashboard becomes useful without keeping the callback request open.

The signed authorization URL necessarily goes to the browser. The partner key, access token, and refresh token stay on the server.

### Callback correlation gate

Do not assume Shopee implements generic OAuth state or PKCE. In the sandbox, verify whether a nonce placed in the redirect URL's query survives the round trip and is allowed by the app's callback registration rules. If so, compare it against both the cookie and stored attempt before token exchange.

Use a documented equivalent only if that mechanism is unavailable. A cookie alone is not a substitute for round-trip callback correlation. Production connection remains disabled until the chosen mechanism passes both valid and forged-callback tests. The single-shop allowlist is an additional check.

### Failure and replay behavior

| Case | Required behavior |
| --- | --- |
| Seller cancels consent | Show a neutral retry option if a callback arrives; otherwise expire the pending attempt |
| Missing code, shop, or nonce | Exchange nothing; return a clean error state |
| Wrong session, expired attempt, wrong environment/shop | Reject; preserve any existing connection |
| Expired dashboard session | Require a new sign-in and connection attempt; do not send the raw Shopee callback through a login redirect |
| Callback reload/replay | Return the saved result or "processing"; never exchange the code twice |
| Exchange request times out ambiguously | Stop and request a fresh authorization attempt; do not blindly replay a possibly consumed code |
| Token exchange succeeds but SQL save fails | Persist the in-memory result if safely retryable; after process loss require a new attempt |
| Reconnection while jobs are running | Advance connection generation; old jobs cannot overwrite the new credentials |
| Arbitrary returnTo parameter | Ignore/reject; return only to the stored allowlisted local path |

Handle the callback explicitly outside a generic redirect-to-login guard; it still performs its own strict authentication checks. Return Cache-Control: no-store and Referrer-Policy: no-referrer, immediately remove secrets from the visible URL via the final redirect, and redact callback queries from application/request logs where configurable.

### Token lifecycle

- Encrypt tokens with authenticated encryption such as AES-256-GCM, random nonces, and a key version; keep encryption keys outside SQL.
- Store access_expires_at using the response's lifetime. Schedule a refresh roughly 10 minutes before expiry and check token validity before source calls.
- Refresh using POST /api/v2/auth/access_token/get. Persist the returned access token and rotated refresh token together.
- Serialize refreshes per connection using a PostgreSQL lock on a dedicated connection. Re-read credentials under the lock and compare connection generation/version before writing.
- Retry a safe read at most once after a successful token refresh. A definite revocation/invalid refresh transitions the shop to "Reconnect required".
- A lost refresh response may have consumed the old refresh token. Do not retry indefinitely; expose recovery/reconnection if the usable replacement cannot be recovered.
- Disconnect stops future jobs and removes usable credentials while retaining permitted historical business records. Reject writes from the old connection generation.

## 5. SQL model

Use migrations and foreign keys from the start. External IDs should be strings or BigInt-safe values. Use decimal money or integer minor units with currency, never floating-point arithmetic. Store timestamps in UTC and group reports in Asia/Jakarta.

| Tables | Purpose and constraints |
| --- | --- |
| Auth library tables | Owner user, Google account, sessions, and verification records |
| shops, shop_connections | Shop identity/ownership, environment, encrypted tokens, expiries, connection status/generation; unique source shop per environment/app |
| auth_attempts | Hashed callback nonce, session binding, expected shop, expiry, attempt/result status |
| products, product_variants | Source catalog, source IDs, model/SKU mapping; source IDs are authoritative when SKU text is blank or duplicated |
| sku_cost_versions | Manual cost, currency, effective date, components, and audit record |
| orders | Current source status, identifiers, source timestamps, checkout totals, and observed/last-synced timestamps; unique shop + order_sn |
| order_items | Source line identity, quantity, original price snapshot, current source fields, mapped variant, and cost snapshot/provenance |
| returns, return_items | Return IDs, affected lines/quantities, status, requested amounts, confirmed outcomes; independent of order status |
| financial_snapshots | Versioned normalized source financial state and source identity/hash |
| financial_entries | Append-only economic entries and explicit corrections/reversals, linked to their source and snapshot |
| order_history | Observed changes with source and observation timestamps; not a claim to capture every event between polls |
| sync_state | Shop/resource checkpoint, coverage range, next due time, last success/error, and reconciliation position |
| sync_runs | Start/end, reason, resource window, counts, checkpoint, failure details, and job ID |
| pg-boss schema | Durable jobs, schedules, retries, and dead-letter state |

Add indexes for shop + created_at, shop + status, source_updated_at, return status, and financial effective dates.

If the API supplies a stable order-line identifier, use it. Otherwise define and fixture-test a composite identity including a line discriminator so repeated items, bundles, and promotions cannot collapse into one line.

Choose the effective SKU cost for the original sale date when available. Imported older orders without a reliable historic cost stay "missing" or "estimated"; do not label today's cost as the actual historic cost. Editing a SKU cost creates a new version and does not overwrite order snapshots. Explicit historical corrections require an audited action.

## 6. Sync implementation

### Jobs and schedules

| Trigger/resource | Starting policy |
| --- | --- |
| First successful connection | Import shop/catalog and the latest 30 days first, then backfill the remaining queryable history in bounded jobs; record actual coverage |
| Orders | Updated records every 10 minutes |
| Returns | Independently updated returns every 10 minutes |
| Finance | Every 10 minutes where supported; otherwise endpoint-specific transaction discovery plus order settlement rechecks |
| Products/variants | Hourly changes and a nightly catalog reconciliation |
| Token refresh | Based on stored expiry, including periods with no shop activity |
| Sync now | Queue a deduplicated high-priority job; return HTTP 202 with job ID |
| Dashboard opens | Render SQL immediately; enqueue a sync if the relevant last success is over 10 minutes old |
| Nightly, 02:00 WIB | Reconcile recent orders plus all reachable open returns/unsettled orders |
| Worker startup/recovery | Scan overdue resources and enqueue catch-up work |

The worker checks due tasks periodically; it does not poll Shopee every second. Database job polling is independent from the Shopee sync cadence. Job names include initial_import, orders_delta, returns_delta, finance_delta, catalog_sync, refresh_token, and reconcile_shop.

### Incremental algorithm

1. Acquire the resource/shop execution lock and verify connection generation.
2. Read that resource's committed checkpoint. Start five minutes before it for overlap. Use a fixed upper bound such as worker time minus 60 seconds for source-indexing delay.
3. Split the interval into the maximum date-window sizes actually supported by the endpoint. For orders, use time_range_field=update_time. Return lists expose update_time_from/update_time_to; validate exact limits and pagination in the app contract.
4. Fetch every page, then fetch required details in supported batches. Apply rate limits and bounded concurrency.
5. In short SQL transactions, upsert current source data, append real observed changes, preserve local fields/cost snapshots, and apply idempotent financial changes.
6. Compare source versions/timestamps before writing. Equal/coarse timestamps require serialized fresh reads; a partial response never clears fields it did not include.
7. Advance the resource checkpoint to the fixed upper bound only after all pages and required details in that window commit successfully. An empty successful window can advance.
8. On failure, retain the old checkpoint and retry the same window. A crash after partial writes is safe because writes and ledger identities are deduplicated.
9. Record run results and freshness separately for orders, returns, and finance.

Use tested cursor resumption only where the API guarantees cursor validity; otherwise restart the bounded window on retry. Paginate backlogs in bounded jobs rather than holding one long web request or SQL transaction.

### Recovery and reconciliation rules

- Serialize jobs per shop/resource and serialize token rotation per connection; all processors must still tolerate job redelivery.
- Honor provider retry guidance. Use bounded exponential backoff with jitter for timeouts, transient errors, and rate limits. Do not retry permanent permission errors indefinitely.
- Initial import uses a fixed cutoff, then immediately runs incremental catch-up so updates during backfill are not lost.
- Keep historical backfill progress separate from the incremental checkpoint so current updates continue while older history imports.
- If a return or payment refers to an order outside imported coverage, fetch the missing parent order/items before saving the linked business record. If source access prevents that, retain an unresolved source record with its identifiers in a sync exception record, expose the gap, and fail that resource window instead of silently dropping it.
- Start reconciliation with a configurable 90-day recent-order lookback, subject to accessible history. Re-fetch all known open returns and unsettled orders regardless of creation date when their IDs remain accessible.
- Cycle through older accessible cohorts weekly within the rate budget. A short lookback alone is not evidence that old financial records cannot change.
- If a prolonged outage exceeds queryable history, mark the missing coverage explicitly. Do not move the checkpoint past an unprocessed gap and claim success.
- Recheck queued/due work on startup. A two-day worker outage catches up from SQL checkpoints after restart.
- Never delete local business records merely because an API list stops returning them.

## 7. Returns, refunds, and reporting rules

Order status, return status, and financial state are independent.

Illustrative acceptance case:

| Observation | Stored result |
| --- | --- |
| An order completes for Rp110,000 | Keep its order/items and record the recognized sale once |
| A return is requested days later | Add/update the linked return; no confirmed refund entry yet |
| A Rp40,000 partial refund is confirmed | Record one refund effect and affected quantities/lines |
| The same payload is imported again | No duplicate sale/refund/fee entry |
| Later source data corrects that refund | Append an explicit delta/reversal with source provenance |

The reporting result is Rp110,000 sales, Rp40,000 refunds, and Rp70,000 retained sales before fees and costs.

Prefer stable provider transaction/effect IDs for financial deduplication. If the source exposes only cumulative order financial totals, normalize a financial snapshot, compare with its prior committed version, and append only its component deltas atomically. Deduplicate each delta by snapshot version and component.

Choose one authoritative source for each economic effect. A refund in both return data and wallet/settlement data is one refund, not two. A payout is a cash transfer, not another sale. Do not subtract fees/refunds again when a source net-proceeds figure already includes them.

Reporting contracts:

- Default sales view uses order-date cohorts in Asia/Jakarta and excludes unpaid/cancelled orders from recognized sales.
- Separate placed-order value/count from completed sales so quick buyer cancellations remain visible.
- A late refund restates the original order cohort. A separate settlement/cash view groups financial movements by source effective date.
- Show confirmed amounts separately from estimates and expose missing fee/cost coverage.
- Estimated contribution profit equals retained seller proceeds minus the cost of the sold goods and additional recorded costs, with no double counting.
- A returned item does not automatically reverse production cost or become resellable stock; use an explicit recovery/write-off decision.
- Show partial returns/refunds without changing the entire order to a fabricated Shopee status.

Initially query these reports directly from indexed SQL. Add cached daily aggregates only if measured performance requires them; corrections must rebuild all affected historical dates.

## 8. Pages, routes, and source layout

| Page | Required behavior |
| --- | --- |
| /login | Google owner sign-in and clean auth errors |
| /overview | Date filters, sales/refunds/profit cards, trend chart, status breakdown, coverage/freshness |
| /orders | Search, status/date filters, pagination, returns badges, source freshness |
| /orders/[orderSn] | Items, cost snapshots, source status, returns, financial entries, observed history |
| /products | Variant/SKU mapping, editable cost versions, missing-cost flags |
| /returns | Open/resolved returns, affected items, confirmed vs requested refunds |
| /settings/integrations | Connect/reconnect/disconnect, expected shop, connection status, initial import progress |
| /settings/sync | Resource checkpoints, run history, errors, retry, coverage gaps |

Backend contract:

| Route | Contract |
| --- | --- |
| /api/auth/[...all] | Better Auth handlers; Google callback remains within this namespace |
| POST /api/integrations/shopee/connect | Owner + CSRF validation; creates attempt and redirects |
| GET /api/integrations/shopee/callback | Strict callback validation, code exchange, persistence, clean redirect |
| POST /api/integrations/shopee/disconnect | Owner + CSRF validation; disables connection and pending work |
| POST /api/shops/[shopId]/sync | Verify shop ownership; deduplicate request; return 202 + job ID |
| GET /api/sync/jobs/[jobId] | Owner-scoped job/run progress |
| GET /api/reports/overview | SQL-only aggregates and data-coverage metadata |
| GET /api/orders | Owner-scoped, validated pagination/filtering |
| GET /api/orders/[orderSn] | Owner-scoped order detail |
| POST /api/variants/[variantId]/costs | Create audited effective-dated cost version |
| GET /api/health | Minimal application liveness; detailed worker/database checks stay private |

Use direct server-side service calls for server-rendered pages rather than making the server call its own HTTP API. All mutations and data-access services enforce owner/shop authorization; page hiding alone is insufficient.

Suggested module boundaries: src/app for UI/routes; src/server/auth, db, shopee, sync, reports, costs for domain services; src/worker for queue handlers/schedules; prisma for schema/migrations; tests for fixtures, SQL integration tests, and browser tests.

Create a typed Shopee adapter for signing, auth/token operations, shop identity, orders, catalog, returns, and finance. Mock that adapter in UI/development; do not scatter raw API calls across page components.

## 9. Ordered milestones and acceptance checks

Estimates assume one developer, approved/testable API access, and a single-shop MVP. Total: roughly 9–12 focused development days; external approval/credentials waiting time is additional.

| Milestone | Deliverable | Acceptance gate | Effort |
| --- | --- | --- | --- |
| 0. Access proof | API contract checklist, credentials/config inventory, stable callback test | Sandbox round trip + code exchange + one permitted data request | 0.5–1 day |
| 1. Foundation | App shell, SQL migrations, Google owner access, worker and durable queue, demo fixtures | Unapproved users blocked; web/worker share SQL; queued job survives restart | 1 day |
| 2. Shopee connection | Signed connect route, nonce/session checks, token encryption/rotation, reconnect/disconnect | Valid flow returns to settings; forged/replayed/expired callbacks fail safely | 1–2 days |
| 3. Durable sync | Initial import, order/return checkpoints, retries, manual jobs, reconciliation skeleton | Paginated import, two-day catch-up, and replay produce correct unique records | 2 days |
| 4. Finance and costs | Partial refunds, financial provenance/deltas, historical SKU costs, report calculations | Rp110k/Rp40k case and later corrections pass without double counting | 2 days |
| 5. Dashboard | Overview, orders/details, products/costs, returns, integration/sync settings | UI reflects SQL immediately and shows stale/partial data clearly | 1–2 days |
| 6. Production readiness | Environment setup, migrations, backups/restore, logs, worker alerts, live smoke test | Real-shop connection, sync/refresh, failed-job recovery, and restore rehearsal pass | 1–2 days |

The first useful vertical slice is milestone 2 plus one milestone-3 order import: sign in, connect Shopee, return to settings, then see an imported order after refreshing. Deliver that before building all charts.

### Required test scenarios

- Signing matches official test examples for public and shop-authenticated requests; request timestamps and redirect encoding are correct.
- Google login permits only the configured verified owner identity.
- Shopee valid callback, wrong nonce, wrong session, expired attempt, wrong shop/environment, denied consent, missing parameters, replay, and expired dashboard session.
- No raw authorization code or tokens in final URLs, HTML, client bundles, or application logs.
- Two refresh jobs cannot consume the same rotating refresh token; reconnect/disconnect prevents old jobs from restoring old credentials.
- Failure on page 3 leaves its window checkpoint unchanged; replay after partial commits creates no duplicates.
- Updates on window boundaries and records updated during initial import are caught.
- Two simultaneous "Sync now" requests create at most one active equivalent job.
- Completed order followed by a partial refund, full refund, refund correction, and fee adjustment stays accurate.
- The same refund appearing in returns and settlement data is counted once.
- Changing SKU costs does not silently rewrite historical order cost.
- A worker restart, rate-limit response, permission error, and outage beyond available history show the appropriate recovery or gap.
- Date boundaries around midnight WIB group consistently.
- Backups restore the business tables, job/checkpoint state, and usable encrypted credentials when the required key is available.

Use mocks and fixtures for failure coverage, real PostgreSQL for constraints/transactions/concurrency, and sandbox/live smoke tests for the provider redirect. A mocked callback alone does not prove Shopee's redirect contract.

## 10. Deployment and operational configuration

Deploy three Railway services from one repository: web, worker, and PostgreSQL, with separate staging/production environments.

Configuration inventory:

- APP_BASE_URL; BETTER_AUTH_URL; BETTER_AUTH_SECRET.
- GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
- OWNER_GOOGLE_SUB/verified owner email allowlist.
- DATABASE_URL, with bounded connection pools for web and worker.
- SHOPEE_ENV, SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY, SHOPEE_REDIRECT_URI.
- SHOPEE_ALLOWED_SHOP_IDS and an environment-to-approved-host mapping.
- TOKEN_ENCRYPTION_KEY and key version.
- BUSINESS_TIMEZONE=Asia/Jakarta, SYNC_INTERVAL_MINUTES=10.
- INITIAL_IMPORT_DAYS=30, RECONCILIATION_LOOKBACK_DAYS=90, and validated endpoint limits.

Check actual environment-variable naming in the selected auth version. No Shopee secret may use a NEXT_PUBLIC_ prefix.

Run application and queue migrations in a controlled release step before starting compatible processes. Configure worker restarts and graceful shutdown, bounded API timeouts, a heartbeat, failed-job visibility, and alerts for missing successful syncs or upcoming authorization expiry. Do not send third-party notifications until an alert destination is explicitly configured.

Enable scheduled backups with a retention target appropriate for the shop and rehearse a restore before relying on this system as the permanent copy. Back up encryption-key recovery material separately from the database.

Production completion means: a permitted real shop can connect and reconnect; tokens refresh while the dashboard is closed; orders/returns/finance update from durable checkpoints; late refunds revise the correct reports; historical costs remain intact; and a failed worker/database restore can recover without inventing missing history.

## 11. Official references checked

Shopee references were checked through official indexed excerpts on 15 October 2026; full-page retrieval was blocked as described above.

- [Shopee authorization and authentication](https://open.shopee.com/developer-guide/20): seller redirect, code exchange, signing, token lifecycle.
- [Shopee get access token](https://open.shopee.com/documents/v2/v2.public.get_access_token?module=104&type=1): authorization-code exchange at /api/v2/auth/token/get.
- [Shopee refresh access token](https://open.shopee.com/documents/v2/v2.public.refresh_access_token?module=104&type=1): rotating refresh tokens and /api/v2/auth/access_token/get.
- [Shopee order list](https://open.shopee.com/documents/v2/v2.order.get_order_list?module=94&type=1): create_time/update_time selection.
- [Shopee return list](https://open.shopee.com/documents/v2/v2.returns.get_return_list?module=102&type=1): return update-time filters.
- [Shopee wallet transactions](https://open.shopee.com/documents/v2/v2.payment.get_wallet_transaction_list?module=97&type=1): potential payment transaction source, subject to approved access.
- [Shopee payout details](https://open.shopee.com/documents/v2/v2.payment.get_payout_detail?module=97&type=1): cross-border-only scope caveat.
- [Next.js authentication](https://nextjs.org/docs/app/guides/authentication): server-side authentication and authorization boundaries.
- [Better Auth Next.js integration](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/integrations/next.mdx): auth handler routing.
- [Better Auth Google provider](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/authentication/google.mdx): Google callback configuration.
- [Prisma with Better Auth and Next.js](https://www.prisma.io/docs/guides/authentication/better-auth/nextjs): supported Prisma 7 integration.
- [pg-boss](https://pgboss.io/): PostgreSQL jobs, transactions, schedules, concurrency, and retries.
