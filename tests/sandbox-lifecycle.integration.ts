import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { callbackParameters } from "../src/core/authorization.ts";
import { decryptToken } from "../src/core/security.ts";

// This suite never contacts Shopee. It exercises the real SQL/queue/service
// boundary using deterministic provider responses, independently of live QA.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.toLowerCase().includes("test")) throw new Error("Use a dedicated TEST_DATABASE_URL containing 'test'.");
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  DATOKO_MODE: "live",
  APP_BASE_URL: "https://datoko.example.test",
  BETTER_AUTH_SECRET: "integration-only-auth-secret-32-characters",
  GOOGLE_CLIENT_ID: "integration-only", GOOGLE_CLIENT_SECRET: "integration-only",
  OWNER_EMAIL: "owner@example.test",
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString("base64"),
  SHOPEE_ENV: "sandbox", SHOPEE_PARTNER_ID: "1000", SHOPEE_PARTNER_KEY: "integration-only",
  SHOPEE_REDIRECT_URI: "https://datoko.example.test/api/integrations/shopee/callback",
  INITIAL_IMPORT_DAYS: "1",
});

const { getDb, closeDb } = await import("../src/server/db.ts");
const { getQueue, enqueueSync } = await import("../src/server/queue.ts");
const { beginConnection, finishConnection, accessForShop, disconnectShop } = await import("../src/server/connections.ts");
const { runShopSync } = await import("../src/server/sync.ts");

test("sandbox service lifecycle with real PostgreSQL and simulated Shopee", async t => {
  const db = getDb();
  const boss = await getQueue();
  const ownerId = `lifecycle-${randomUUID()}`;
  const sourceShopId = String(Date.now());
  process.env.SHOPEE_ALLOWED_SHOP_IDS = sourceShopId;
  const actor = { ownerId, sessionId: randomUUID() };
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY!;
  let shopId: string | undefined;
  let exchangeCount = 0;
  let refreshCount = 0;
  let listCount = 0;
  let failSecondPage = false;
  let failRefresh = false;
  let updated = false;
  const baseTime = Math.floor(Date.now() / 1000);
  const orderSns = [`TESTA-${sourceShopId}`, `TESTB-${sourceShopId}`];
  const itemId = "9007199254740993";

  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "https://openplatform.sandbox.test-stable.shopee.sg", "No network requests may escape the sandbox fixture");
    assert.equal(url.searchParams.get("partner_id"), "1000");
    assert.match(url.searchParams.get("sign") ?? "", /^[a-f0-9]{64}$/);
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/api/v2/auth/token/get") {
      exchangeCount++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.shop_id, Number(sourceShopId));
      assert.equal(body.partner_id, 1000);
      assert.match(body.code, /^fixture-code-/);
      return json({ access_token: `access-${exchangeCount}`, refresh_token: `refresh-${exchangeCount}`, expire_in: 14400 });
    }
    if (url.pathname === "/api/v2/auth/access_token/get") {
      refreshCount++;
      assert.equal(JSON.parse(String(init?.body)).refresh_token, "refresh-1");
      if (failRefresh) throw new TypeError("Simulated response lost after refresh token consumption");
      return json({ access_token: "rotated-access", refresh_token: "rotated-refresh", expire_in: 14400 });
    }
    assert.equal(url.searchParams.get("shop_id"), sourceShopId);
    assert.ok(url.searchParams.get("access_token"));
    if (url.pathname === "/api/v2/shop/get_shop_info") return json({ response: { shop_id: sourceShopId, shop_name: "Sandbox fixture shop", region: "ID" } });
    if (url.pathname === "/api/v2/order/get_order_list") {
      listCount++;
      assert.equal(url.searchParams.get("time_range_field"), "update_time");
      const secondPage = url.searchParams.get("cursor") === "page-2";
      if (secondPage && failSecondPage) return json({}, 429);
      return json({ response: { order_list: [{ order_sn: orderSns[secondPage ? 1 : 0] }], more: !secondPage, next_cursor: secondPage ? "" : "page-2" } });
    }
    if (url.pathname === "/api/v2/order/get_order_detail") {
      const requested = (url.searchParams.get("order_sn_list") ?? "").split(",");
      return json({ response: { order_list: requested.map(orderSn => ({
        order_sn: orderSn, order_status: updated ? "COMPLETED" : "READY_TO_SHIP", currency: "IDR", total_amount: "110000.1250",
        create_time: baseTime - 1200, update_time: baseTime - (updated ? 120 : 600),
        item_list: [{ item_id: itemId, model_id: "10", order_item_id: "20", item_name: "Fixture product", model_sku: "FIXTURE-SKU", model_quantity_purchased: 2, model_original_price: "60000", model_discounted_price: "55000.0625" }],
      })) } });
    }
    throw new Error(`Unexpected provider path: ${url.pathname}`);
  });

  t.after(async () => {
    try {
      if (shopId) {
        await db.$executeRaw`DELETE FROM pgboss.job WHERE data->>'shopId' = ${shopId}`;
        await db.orderHistory.deleteMany({ where: { order: { shopId } } });
        await db.orderItem.deleteMany({ where: { order: { shopId } } });
        await db.order.deleteMany({ where: { shopId } });
        await db.skuCostVersion.deleteMany({ where: { variant: { shopId } } });
        await db.productVariant.deleteMany({ where: { shopId } });
        await db.syncState.deleteMany({ where: { shopId } });
        await db.syncRun.deleteMany({ where: { shopId } });
        await db.shopConnection.deleteMany({ where: { shopId } });
        await db.shop.deleteMany({ where: { id: shopId } });
      }
      await db.authAttempt.deleteMany({ where: { ownerId } });
      await db.user.deleteMany({ where: { id: ownerId } });
    } finally {
      try { await boss.stop({ graceful: true }); }
      finally { await closeDb(); }
    }
  });

  await db.user.create({ data: { id: ownerId, name: "Fixture owner", email: `${ownerId}@example.test`, emailVerified: true } });
  const connect = async () => {
    const started = await beginConnection(actor, sourceShopId, "/settings/integrations");
    const authorization = new URL(started.url);
    assert.equal(authorization.origin, "https://open.sandbox.test-stable.shopee.com");
    assert.equal(authorization.pathname, "/auth");
    const callback = new URL(authorization.searchParams.get("redirect_uri")!);
    assert.equal(callback.origin, process.env.APP_BASE_URL);
    callback.searchParams.set("state", authorization.searchParams.get("state")!);
    callback.searchParams.set("code", `fixture-code-${randomUUID()}`);
    callback.searchParams.set("shop_id", sourceShopId);
    const [attemptId, browserSecret] = started.cookie.split(".");
    const attempt = await db.authAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const input = { ...actor, ...callbackParameters(callback.searchParams), browserSecret, environment: "sandbox" as const, now: new Date() };
    return { attempt, input };
  };

  const first = await connect();
  assert.equal(await finishConnection(first.attempt, first.input), "connected");
  const shop = await db.shop.findUniqueOrThrow({ where: { environment_sourceShopId: { environment: "sandbox", sourceShopId } }, include: { connection: true } });
  shopId = shop.id;
  assert.equal(shop.connection?.status, "CONNECTED");
  assert.equal(shop.connection?.version, 1);
  assert.notEqual(shop.connection?.accessTokenCipher, "access-1");
  assert.equal(decryptToken(shop.connection!.accessTokenCipher!, encryptionKey, `sandbox:${sourceShopId}:access`), "access-1");
  const replay = await db.authAttempt.findUniqueOrThrow({ where: { id: first.attempt.id } });
  assert.equal(await finishConnection(replay, first.input), "connected");
  assert.equal(exchangeCount, 1);
  t.diagnostic("Authorization, encrypted persistence, initial enqueue, and replay protection passed.");

  const variant = await db.productVariant.create({ data: { shopId, sourceItemId: itemId, sourceModelId: "10", name: "Fixture product" } });
  const cost = await db.skuCostVersion.create({ data: { variantId: variant.id, amount: "50000", effectiveAt: new Date((baseTime - 1800) * 1000), createdBy: ownerId } });
  const [queued, duplicate] = await Promise.all([1, 2].map(() => db.$transaction(tx => enqueueSync(tx, boss, { shopId: shop.id, generation: 1, reason: "TEST" }))));
  assert.equal(queued.jobId, duplicate.jobId);
  assert.equal(await db.syncRun.count({ where: { shopId } }), 1);
  const job = { runId: queued.runId, shopId, generation: 1 };
  await runShopSync(job);
  assert.equal(await db.order.count({ where: { shopId } }), 2);
  assert.equal(await db.orderItem.count({ where: { order: { shopId }, costVersionId: cost.id } }), 2);
  assert.equal((await db.syncRun.findUniqueOrThrow({ where: { id: job.runId } })).status, "SUCCEEDED");
  assert.equal(listCount, 2);
  const state = await db.syncState.findUniqueOrThrow({ where: { shopId_resource: { shopId, resource: "orders" } } });
  assert.ok(state.checkpoint);
  t.diagnostic("Two-page order import, queue deduplication, and historical cost snapshots passed.");

  await db.skuCostVersion.create({ data: { variantId: variant.id, amount: "70000", effectiveAt: new Date((baseTime - 300) * 1000), createdBy: ownerId } });
  updated = true;
  const next = await db.$transaction(tx => enqueueSync(tx, boss, { shopId: shop.id, generation: 1, reason: "TEST" }));
  const nextJob = { ...job, runId: next.runId };
  failSecondPage = true;
  await assert.rejects(runShopSync(nextJob), { code: "SHOPEE_RATE_LIMIT" });
  assert.equal((await db.syncState.findUniqueOrThrow({ where: { id: state.id } })).checkpoint?.getTime(), state.checkpoint.getTime());
  failSecondPage = false;
  await runShopSync(nextJob);
  assert.equal(await db.order.count({ where: { shopId } }), 2);
  assert.equal(await db.orderItem.count({ where: { order: { shopId } } }), 2);
  assert.equal(await db.orderHistory.count({ where: { order: { shopId } } }), 4);
  const snapshots = await db.orderItem.findMany({ where: { order: { shopId } } });
  assert.ok(snapshots.every(item => item.costSnapshot?.toString() === "50000" && item.costVersionId === cost.id));
  assert.equal((await db.syncState.findUniqueOrThrow({ where: { id: state.id } })).lastErrorCode, null);
  t.diagnostic("Page failure retained the checkpoint; retry preserved order/history/cost idempotency.");

  await db.shopConnection.update({ where: { shopId }, data: { accessExpiresAt: new Date(0) } });
  assert.equal((await accessForShop(shopId, 1)).accessToken, "rotated-access");
  assert.equal((await accessForShop(shopId, 1)).accessToken, "rotated-access");
  assert.equal(refreshCount, 1);
  assert.equal(decryptToken((await db.shopConnection.findUniqueOrThrow({ where: { shopId } })).refreshTokenCipher!, encryptionKey, `sandbox:${sourceShopId}:refresh`), "rotated-refresh");
  // Reset only the fixture's encrypted token to prove an uncertain exchange
  // cannot repeatedly consume the original refresh token.
  await db.shopConnection.update({ where: { shopId }, data: { accessExpiresAt: new Date(0), refreshTokenCipher: shop.connection!.refreshTokenCipher } });
  failRefresh = true;
  await assert.rejects(accessForShop(shopId, 1), { code: "SHOPEE_REQUEST_UNCERTAIN" });
  assert.equal((await db.shopConnection.findUniqueOrThrow({ where: { shopId } })).status, "RECONNECT_REQUIRED");
  await assert.rejects(accessForShop(shopId, 1));
  assert.equal(refreshCount, 2);
  t.diagnostic("Refresh rotation and uncertain-refresh reconnection requirements passed.");

  const stale = await db.$transaction(tx => enqueueSync(tx, boss, { shopId: shop.id, generation: 1, reason: "TEST" }));
  const reconnect = await connect();
  assert.equal(await finishConnection(reconnect.attempt, reconnect.input), "connected");
  assert.equal((await db.shopConnection.findUniqueOrThrow({ where: { shopId } })).version, 2);
  const readsBeforeStaleJob = listCount;
  await runShopSync({ ...job, runId: stale.runId });
  assert.equal((await db.syncRun.findUniqueOrThrow({ where: { id: stale.runId } })).status, "CANCELLED");
  assert.equal(listCount, readsBeforeStaleJob);
  const pending = await connect();
  await disconnectShop(shopId, ownerId);
  const disconnected = await db.shopConnection.findUniqueOrThrow({ where: { shopId } });
  assert.equal(disconnected.status, "DISCONNECTED");
  assert.equal(disconnected.accessTokenCipher, null);
  assert.equal(disconnected.refreshTokenCipher, null);
  assert.equal(disconnected.version, 3);
  assert.equal(await db.order.count({ where: { shopId } }), 2);
  const cancelled = await db.authAttempt.findUniqueOrThrow({ where: { id: pending.attempt.id } });
  await assert.rejects(finishConnection(cancelled, pending.input), { code: "AUTH_ATTEMPT_USED" });
  assert.equal(exchangeCount, 2);
  t.diagnostic("Reconnect generation fencing, disconnect token removal, and record retention passed.");
});
