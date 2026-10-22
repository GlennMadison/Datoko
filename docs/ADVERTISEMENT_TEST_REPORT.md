# Advertisement implementation verification

Verified locally on 16 October 2026 in the Datoko repository. The application database has the additive advertising migration applied; the final database-to-schema comparison is empty.

| Check | Result |
| --- | --- |
| Core tests (`npm test`) | 60 passed |
| Dedicated PostgreSQL integration tests (`npm run test:db`) | 36 passed |
| Production demo browser tests, desktop and mobile | 22 passed |
| Production HTTPS owner browser tests, desktop and mobile | 4 passed |
| TypeScript, Prisma generation and schema validation | Passed |
| Production build | Passed |
| Application migration status / schema comparison | Up to date / no differences |
| Dependency audit, including development dependencies | 0 reported vulnerabilities |

Environment: Windows, Node 25.2.1, Next.js 16.4.1, Prisma CLI/client/PostgreSQL adapter 7.10.1, PostgreSQL 17.10, Chromium through Playwright 1.64.1. CI targets Node 24; the remote CI run has not been performed in this session.

## Financial cases verified

- Original revenue Rp1,000,000 / spend Rp100,000 = 10.00x. A confirmed attributed refund of Rp300,000 leaves Real ROAS 7.00x.
- A later full cancellation leaves Real ROAS 0.00x and excluded revenue Rp1,000,000; the existing refund is not deducted again.
- Partial returned units use separate credited entitlements. Partial refunds reduce only their own retained credit.
- Organic cancellations are not deducted. Known order refunds can invalidate contradictory evidence without assigning shipping or organic losses to ads.
- Multi-period ROAS uses total revenue / total spend, not an average of individual ROAS values.
- Integer arithmetic preserves four decimal places and values beyond JavaScript's safe integer range. Display ratios round once to two places.
- Zero spend gives Unavailable; known zero revenue with positive spend gives 0.00x.
- Incomplete attribution/outcomes, missing periods, unmatched items, stale return evidence, duplicate credits, excessive credits, and contradictory outcomes prevent an exact adjusted total.
- Excess item credits are checked outside the selected dates within the same source scope.

## Browser and data path verified

The authenticated test uses an actual owner account, signed secure session cookie, HTTPS, browser file upload, the real import API, PostgreSQL records, server reporting, and rendered ROAS cards. It then changes the stored order to CANCELLED and verifies the restated historical result. It uses synthetic reports and orders in a separate test database.

Today, custom dates, year/month/week selectors, graph interval changes, navigation, back history, rapid successive selections, invalid custom dates, and read-only demo behavior pass on desktop and mobile. There is no date Apply button. Daily/hourly demo totals reconcile. Daily-only live source records cannot generate hourly data. Advertisement screenshots were visually inspected at both viewport sizes.

The final two-panel calendar picker passed 22 production demo browser checks on 16 October 2026, including quick ranges, leap-day selection, month weeks, full-year ranges, custom-date validation, automatic refresh, navigation history, rapid changes, keyboard activation, Escape, and outside-click dismissal. The production build, including TypeScript, passed in a temporary project copy with identical source and no private environment file, using a fresh generated output directory after Windows blocked rewriting the previous output. Desktop and mobile screenshots confirm that Date range and Interval sit together below summary cards and immediately above graphs, with no page overflow. The core, database, and HTTPS owner results above are from the preceding implementation verification; this UI change does not modify calculation, API, authorization, or database code.

Owner checks protect imports and reference downloads. Wrong owners/environments, cross-origin POSTs, malformed/oversized JSON, unreconciled credits, stale revisions, and duplicate source credits are rejected. Failed imports roll back the complete file. Equivalent retries are idempotent. Prior revisions remain in the audit table. Report reads use a read-only repeatable snapshot. Database constraints independently reject negative financial values.

Existing owner signup/login/logout, cost snapshot retention, callback validation, encrypted token lifecycle, sync deduplication, and simulated Shopee lifecycle tests continue to pass. Native form Origin headers and clean callback redirects are also checked.

## Compatibility and security changes

Database sessions explicitly use UTC so Prisma's timestamp serialization is independent of the PostgreSQL host timezone; reporting converts dates to WIB. A round-trip test runs against a database whose host default is Asia/Bangkok.

Prisma and its client/adapter were updated together from 7.10.0 to 7.10.1. The lockfile now resolves the patched transitive dependencies. `npm audit --json` reports zero vulnerabilities after the update. This is the audit result for the installed dependency set, not a guarantee about future advisories.

Windows builds use one prerender worker, one page at a time, and no separate Webpack compilation worker. The environment exhibited intermittent access-denied errors in generated build files; the final regenerated production build and browser runs pass. Browser test servers bind to loopback and stop through parent IPC. HTTPS test certificates are ephemeral and are removed after each run. Production continues to use the normal Next server.

## Remaining source limitations

Automatic Shopee Ads attribution and return ingestion are not connected. The implemented fallback is an explicitly labeled, owner-only normalized source-report import. Aggregate source totals provide Original ROAS; exact Real ROAS requires complete credited item and outcome evidence. An uploaded completeness declaration cannot establish the truth of the underlying source. The dashboard surfaces provenance, timestamps, gaps, and provisional results.

No real Shopee console consent, advertising API access, production callback round trip, or live return ingestion was validated in this work. Existing simulated provider checks do not establish those facts. The changes remain local; no GitHub push or remote deployment was performed.

See [ADVERTISEMENT.md](ADVERTISEMENT.md) for the import contract, calculation definitions, date behavior, and rollout command.
