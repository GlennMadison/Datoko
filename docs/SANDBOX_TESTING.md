# Shopee sandbox verification

Run the local suites before using Shopee's authenticated testing console. Simulated provider responses do not establish compatibility with the real authorization service.

## Repeatable local checks

Use Node 24, install the committed lockfile with `npm ci`, and run:

```powershell
npm run db:generate
npx prisma validate
npm test
npm run typecheck
```

Use a dedicated PostgreSQL database with `test` in its name. The SQL tests create and remove their own fixtures; never use the business database.

```powershell
$env:DATABASE_URL = 'postgresql://datoko:password@127.0.0.1:5432/datoko_test'
$env:TEST_DATABASE_URL = $env:DATABASE_URL
npm run db:deploy
npm run test:db
$env:DATOKO_MODE = 'demo'
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:auth
```

The database lifecycle suite replaces outbound Shopee calls with deterministic responses. It checks authorization binding and replay, encrypted token storage, queue deduplication, two-page order imports, checkpoint rollback on failure, safe retries, immutable costs, refresh rotation, reconnect generations, and disconnect record retention.

The browser suite starts the production build on `127.0.0.1:3100` in read-only demo mode. Desktop and mobile Chromium check page rendering, filters, order detail, unavailable integration controls, mutation rejection, and callback cleanup. The native-form regression submits the rendered form without injecting an Origin header, checking the real browser policy as well as rejection of cross-site/null origins and no-referrer callback/API headers. These tests do not sign in to Google or authorize a Shopee shop.

The separate `test:auth` suite starts a development server on `127.0.0.1:3101` with email/password login and the dedicated test database. It creates a temporary owner, checks password confirmation, signup, protected-page redirects, incorrect-password errors, signout, and login on desktop and mobile, then deletes the fixture. It requires no Google or Shopee credentials. Run it after the production demo suite, since development and production checks share the Next.js output directory.

## Real console cycle

Use only a sandbox application and test shop from [Test Account](https://open.shopee.com/console/tools/test-account). Use [Test Order](https://open.shopee.com/console/tools/test-order) to create and change sandbox orders. Confirm the console's available actions rather than assuming supported transitions.

| Scenario | Evidence required |
| --- | --- |
| Owner sign-in | Owner signs in using the configured auth method and reaches the private dashboard; another account cannot read business data. |
| Callback registration | Stable HTTPS callback matches the sandbox application configuration. |
| Connect | Native form navigates the current tab to Shopee's sandbox authorization page. |
| Consent and return | Sandbox V2 echoes the unpredictable `state`; the owner session and callback browser cookie return to the configured app origin. |
| Connection persistence | Settings show connected; SQL stores ciphertext and one durable initial import job. The final browser URL contains no authorization code. |
| Initial test order | Create a distinguishable order in Test Order, record its ID/status/amount, and compare the imported order and line items. |
| Status change | Use an available console transition, sync again, and verify the order/status history without duplicate orders or lines. |
| Repeated manual sync | Repeat the import and confirm record counts and historical costs stay unchanged. |
| Reconnect | Complete another authorization; an older queued generation cannot overwrite the new connection. |
| Disconnect | Credentials are cleared, queued work is fenced, and saved order records remain visible. |
| Callback failure | Missing/changed state, a different shop, expired attempt, or signed-out owner fails safely and leaves a clean application URL. |
| Refresh | A due token rotates once and subsequent reads use the new pair. An uncertain refresh requires reconnect. |

Record actual app/console URLs, timestamps, sandbox order identifiers, and observed status for each case. Exclude partner keys, signed request URLs, callback codes, browser cookies, and tokens from screenshots and reports.

Keep `SHOPEE_CALLBACK_QUERY_VERIFIED=false` during Sandbox V2 testing. Sandbox V2 uses a top-level `state` parameter rather than a nested `auth_state` query. The legacy production adapter needs separate query-preservation verification before its gate can be enabled. Live returns, settlements, and nightly reconciliation are outside the currently implemented slice and cannot be marked passed.
