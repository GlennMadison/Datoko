# Datoko test report

## Update: 16 October 2026 — native form origin rejection

Reproduced the user's `INVALID_ORIGIN` error in desktop and mobile Chromium by submitting the rendered native Connect Shopee form. The previous global `Referrer-Policy: no-referrer` caused the browser to send the literal `Origin: null`; manually setting Origin in HTTP tests had hidden the issue. The configured localhost origin matched the browser address.

Normal pages now use `strict-origin`, preserving the real Origin for same-origin form POSTs while omitting URL paths from referrers. Auth and Shopee integration API routes retain explicit `no-referrer` configuration because Next.js configured headers can override handler-level headers. Origin/session/state/shop/replay checks remain enforced; literal null, missing, and cross-site origins are rejected.

PASS: production build and 33 core checks. All 12 desktop/mobile demo browser cases passed their assertions, including the new native-form regression, cross-site/null rejection, no-referrer API headers, and clean protected callbacks. The six origin/callback browser cases also completed with exit code 0 when reusing the test server. The existing Windows test-server teardown issue remains documented below. Real Shopee consent and order ingestion remain unverified; this fix addresses the form submission before redirecting to Shopee.

## Update: 16 October 2026 — Sandbox V2 connection

Corrected the sandbox API host to `https://openplatform.sandbox.test-stable.shopee.sg` and the seller authorization entrypoint to `https://open.sandbox.test-stable.shopee.com/auth`, using `partner_id`, `auth_type=seller`, `redirect_uri`, `response_type=code`, and the standard echoed `state`. These addresses and the code flow are indexed in Shopee's Sandbox Testing V2 and Authorization and Authentication guides (https://open.shopee.com/developer-guide/644 and https://open.shopee.com/developer-guide/20). Full unauthenticated page retrieval returned HTTP 403; indexed official excerpts supplied the routing details.

The callback supports the Sandbox V2 `state` and the legacy adapter's `auth_state`, rejects mixed/duplicate/missing state, and retains browser/session/shop/expiry and replay checks. The legacy production adapter was not migrated or verified in this change.

PASS: 33 core checks, TypeScript checking, and the SQL sandbox lifecycle with simulated provider responses. The SQL lifecycle exercises the new authorization URL/state echo through token exchange, import, retries, rotation, reconnect, and disconnect against real PostgreSQL. Test fixtures used only `datoko_test`; no real partner credentials, test orders, or shop authorization were accessed. Real Shopee consent, registered callback acceptance, and real order ingestion remain unverified.

## Update: 16 October 2026 — email/password login

Email/password is now the default authentication method. The existing PostgreSQL accounts schema stores password hashes, so this change requires no additional database migration. Google mode remains optional through `AUTH_METHOD=google`.

- PASS: 31 core checks.
- PASS: 23 PostgreSQL/auth checks, including real email/password HTTP handlers, owner-only signup/access, password hashing, duplicate accounts, incorrect passwords, logout revocation, cross-site rejection, login rate limits, and closed-registration behavior. Existing Google-mode session checks and the simulated Shopee lifecycle still pass.
- PASS: 2 desktop/mobile authentication browser cases covering signup, confirmation mismatch, protected routes, logout, wrong-password errors, successful login, and integration readiness without Google credentials.
- PASS: 10 desktop/mobile production demo browser cases.
- PASS: production build, TypeScript checking, lockfile consistency, and Git whitespace checks.

Browser testing also found and fixed unauthorized dashboard data requests throwing before the layout redirect, controls accepting clicks before their client handlers were ready, and signout being unavailable in the mobile layout. Signup screenshots were inspected at both sizes.

Checks ran in the source directory rather than the earlier validation copy. Fixtures used only the dedicated `datoko_test` database. Real credentials and the user's `.env` were not replaced. Email verification and password-reset email delivery are not configured; create the owner account locally and close registration with `EMAIL_SIGNUP_ENABLED=false` before exposing it publicly.

Automatic test-server teardown still stalls on this Windows host. The final browser runs reused separately launched test servers and exited successfully. `AUTH_E2E_REUSE_SERVER=true` opts the authentication suite into reuse; the test server must use the same `AUTH_E2E_OWNER_EMAIL`, database, origin, and secret as its test configuration. Normal CI uses a fresh server; remote CI has not run. Real Shopee authorization remains unverified.

## Original report

Date: 15 October 2026.

Local automated testing completed. The requested live Shopee console cycle remains blocked. No Shopee test account, test order, API key, callback registration, or real shop authorization was changed.

## Results

| Check | Result | Scope |
| --- | --- | --- |
| Core tests | PASS: 31 | Authorization validation/replay, HMAC, encrypted tokens, exact money, source IDs/orders, pagination/checkpoints. |
| PostgreSQL/session integration | PASS: 13 | SQL rollback/uniqueness, queue deduplication, real auth adapter, simulated Shopee service lifecycle. |
| Desktop/mobile browser tests | PASS: 10 | Production demo navigation, filtering/detail/404, read-only controls, mutation rejection, callback failure cleanup. |
| Prisma generation/validation | PASS | Client 7.10.0 and validated schema. |
| Migration deployment | PASS | Initial migration executed on dedicated PostgreSQL 17.10. |
| Migration/schema drift | PASS | No difference detected. |
| TypeScript checking | PASS | Dependency-resolved checking, including new tests. |
| Production build | PASS | Next.js 16.4.1, Webpack, two build workers. |
| Actual Google consent | NOT RUN | Real provider credentials and interactive consent unavailable. |
| Integrated-browser Shopee cycle | BLOCKED | Browser control process could not launch. |
| GitHub push / remote CI | BLOCKED | Requested repository unavailable to the connected installation. |

## Integration coverage

The lifecycle suite uses real PostgreSQL, Prisma, pg-boss, and application services. Outbound Shopee calls are replaced with deterministic responses. It verifies:

1. Signed authorization URL with a nested nonce, encrypted credential persistence, durable initial import, and replay protection.
2. Concurrent sync deduplication and two-page order import with historical cost snapshots.
3. A second-page rate limit retaining the checkpoint; safe retry without duplicate orders/lines/history or changed cost snapshots.
4. Refresh-token rotation and reconnection after an uncertain refresh, without repeated consumption of the old token.
5. Reconnect generation fencing that cancels an older queued job before it reads orders.
6. Disconnect clearing tokens/cancelling pending authorization while retaining orders.

The session suite seeds only the dedicated test database. The actual Better Auth Prisma adapter accepts the verified owner and rejects missing, tampered, expired, other-user, and unverified-owner sessions. Google subject pinning and sign-out revocation also pass. Google's real callback configuration remains unverified.

The browser callback check covers the demo failure path: HTTP 303, an application destination without code/state, no-store, no-referrer, and expired HttpOnly binding cookie. The successful real provider redirect still needs verification.

## Fixes and repeatability

- Corrected Better Auth generic inference. The original code failed dependency-resolved checking; the factory's inferred type passes and the real adapter is exercised by session tests.
- Selected Webpack after a Turbopack Windows junction failure. Reduced build workers from eleven to two after a prerender permission failure; the full production build then passed.
- Added a lockfile, database lifecycle/session tests, and desktop/mobile Playwright tests. Reduced-motion browser runs produce complete chart screenshots.
- Updated CI to use npm ci, run all suites, and retain reports. Remote CI has not run.
- The first browser run completed ten assertions but stalled during test-server shutdown. The final run reused the demo server and exited successfully: 10 passed in 5.5 seconds. Fresh-server teardown on this Windows host remains unverified; CI starts a fresh server.

Commands and live-console acceptance cases are in SANDBOX_TESTING.md.

## Environment and evidence

- Source: C:\Users\GlennS\Documents\ChatGPT\Shopee Dashboard\Datoko.
- Validation: C:\Users\GlennS\AppData\Local\Temp\DatokoValidation. Installation in the source folder failed with a Windows permission error; build, SQL, and browser checks ran from this writable copy.
- Node 25.2.1, npm 11.6.2, TypeScript 5.9.3, Next.js 16.4.1, React 19.3.1, Prisma 7.10.0, Better Auth 1.7.10, pg-boss 12.38.0.
- PostgreSQL 17.10 on 127.0.0.1:55432, dedicated datoko_test database. Suites remove their fixtures.
- Playwright 1.64.1, Chromium 156.0.8078.4, desktop and Pixel 7 profiles.
- Browser evidence: validation playwright-report/index.html and test-results overview screenshots. Screenshots were inspected; the reduced-motion desktop chart rendered completely.
- Demo health endpoint returned HTTP 200 at http://127.0.0.1:3100/api/health during QA.
- All 65 compared source/test/schema/config files match the validation copy byte for byte; the lockfile matches declared dependencies and engine constraints. Git whitespace checks passed.

## Remaining blockers and limits

The integrated browser failed direct tab access and a reset/state retry with `CreateProcessInSandbox failed with error code 203`. Neither authenticated Shopee testing page could be controlled. Real query preservation, registered callback acceptance, permissions, live order fields, and console status transitions remain unverified. Keep SHOPEE_CALLBACK_QUERY_VERIFIED=false.

GitHub recognizes the requested user, but GlennMadison/Datoko returns 404 and is absent from accessible repositories. Grant this exact repository to the connection before fetching history, pushing, or running CI. No GitHub files changed.

The requested C:\Users\GlennS\Documents\Datoko directory is outside the writable workspace. Source remains in the staging directory above.

`npm audit` reported four high-severity findings affecting Prisma CLI and transitive @prisma/config, deepmerge-ts, and mysql2 packages. No forced downgrade or unverified override was applied. The app uses PostgreSQL; this observation does not establish whether those findings are exploitable in the app.

Live returns, settlements/fees, nightly reconciliation, full older-history backfill, production deployment, and backup recovery remain outside this completed slice.
