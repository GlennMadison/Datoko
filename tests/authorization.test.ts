import { test } from "node:test";
import assert from "node:assert/strict";
import { callbackParameters, completeAuthorization, type AuthAttempt, type CallbackInput, type AuthorizationDependencies } from "../src/core/authorization.ts";
import { digest, randomSecret, encryptToken, decryptToken, assertSameOrigin, safeReturnPath } from "../src/core/security.ts";
import { authorizationUrl, signRequest, parseSourceJson, externalId, SHOPEE_HOSTS } from "../src/core/shopee.ts";

const state = randomSecret();
const browserSecret = randomSecret();
const now = new Date("2026-10-15T14:00:00Z");
const input: CallbackInput = { ownerId: "owner", sessionId: "session", browserSecret, environment: "sandbox", state, code: "test-code-123", shopId: "123456", now };
const attempt: AuthAttempt = { id: "attempt", ownerId: "owner", sessionHash: digest("session"), stateHash: digest(state), browserHash: digest(browserSecret), expectedShopId: "123456", environment: "sandbox", status: "PENDING", expiresAt: new Date(now.getTime() + 600_000), returnPath: "/settings/integrations" };

function setup() {
  const calls: string[] = [];
  let claimed = false;
  const deps: AuthorizationDependencies = {
    claim: async () => { if (claimed) return false; claimed = true; calls.push("claim"); return true; },
    exchange: async () => { calls.push("exchange"); return { accessToken: "access", refreshToken: "refresh", expiresIn: 14400 }; },
    identify: async () => ({ shopId: "123456", name: "Test shop", currency: "IDR" }),
    persist: async () => { calls.push("persist"); },
    fail: async (_, code) => { calls.push(code); },
  };
  return { deps, calls };
}

test("valid callback exchanges once and persists", async () => {
  const { deps, calls } = setup();
  assert.equal(await completeAuthorization(attempt, input, deps), "connected");
  assert.deepEqual(calls, ["claim", "exchange", "persist"]);
});

for (const [name, override] of Object.entries({
  "wrong owner": { ownerId: "attacker" }, "wrong session": { sessionId: "other" },
  "wrong state": { state: randomSecret() }, "wrong browser": { browserSecret: randomSecret() },
  "wrong shop": { shopId: "999" }, "wrong environment": { environment: "production" as const },
  "expired attempt": { now: new Date(now.getTime() + 600_000) },
})) {
  test(`${name} never exchanges credentials`, async () => {
    const { deps, calls } = setup();
    await assert.rejects(completeAuthorization(attempt, { ...input, ...override }, deps));
    assert.deepEqual(calls, []);
  });
}

test("concurrent callback claims cannot both exchange a one-use code", async () => {
  const { deps, calls } = setup();
  const results = await Promise.all([completeAuthorization(attempt, input, deps), completeAuthorization(attempt, input, deps)]);
  assert.deepEqual(results.sort(), ["connected", "processing"]);
  assert.equal(calls.filter(call => call === "exchange").length, 1);
});

test("successful callback replay does not exchange again", async () => {
  const { deps, calls } = setup();
  assert.equal(await completeAuthorization({ ...attempt, status: "SUCCEEDED" }, input, deps), "connected");
  assert.deepEqual(calls, []);
});

test("ambiguous code exchange failure records failure and is not retried", async () => {
  const { deps, calls } = setup();
  deps.exchange = async () => { calls.push("exchange"); throw new Error("timeout"); };
  await assert.rejects(completeAuthorization(attempt, input, deps));
  assert.deepEqual(calls, ["claim", "exchange", "INTERNAL_ERROR"]);
});

test("provider identity mismatch never saves a connection", async () => {
  const { deps, calls } = setup();
  deps.identify = async () => ({ shopId: "999", name: "Wrong shop", currency: "IDR" });
  await assert.rejects(completeAuthorization(attempt, input, deps));
  assert.equal(calls.includes("persist"), false);
});

test("duplicate callback parameters are rejected", () => {
  const params = new URLSearchParams({ code: input.code, shop_id: input.shopId, auth_state: state });
  assert.deepEqual(callbackParameters(params), { code: input.code, shopId: input.shopId, state });
  params.append("shop_id", "999");
  assert.throws(() => callbackParameters(params));
});

test("Sandbox V2 authorization uses the seller code flow and echoed state", () => {
  const url = new URL(authorizationUrl({ environment: "sandbox", partnerId: "1000", partnerKey: "key", callbackUrl: "http://localhost:3000/api/integrations/shopee/callback", state, timestamp: 1700000000 }));
  const callback = new URL(url.searchParams.get("redirect_uri")!);
  assert.equal(url.origin, "https://open.sandbox.test-stable.shopee.com");
  assert.equal(url.pathname, "/auth");
  assert.equal(url.searchParams.get("partner_id"), "1000");
  assert.equal(url.searchParams.get("auth_type"), "seller");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), state);
  assert.equal(callback.pathname, "/api/integrations/shopee/callback");
  assert.equal(callback.search, "");
  assert.equal(url.searchParams.has("sign"), false);
  assert.equal(SHOPEE_HOSTS.sandbox, "https://openplatform.sandbox.test-stable.shopee.sg");
});

test("Sandbox V2 callbacks require exactly one unambiguous state", () => {
  const params = new URLSearchParams({ code: input.code, shop_id: input.shopId, state });
  assert.deepEqual(callbackParameters(params), { code: input.code, shopId: input.shopId, state });
  params.append("state", state);
  assert.throws(() => callbackParameters(params));
  params.delete("state");
  assert.throws(() => callbackParameters(params));
  params.set("state", state);
  params.set("auth_state", state);
  assert.throws(() => callbackParameters(params));
});

test("legacy production authorization retains its signed redirect and binding", () => {
  const url = new URL(authorizationUrl({ environment: "production", partnerId: "1000", partnerKey: "key", callbackUrl: "https://datoko.example/api/integrations/shopee/callback", state, timestamp: 1700000000 }));
  assert.equal(url.origin, "https://partner.shopeemobile.com");
  assert.equal(new URL(url.searchParams.get("redirect")!).searchParams.get("auth_state"), state);
  assert.equal(url.searchParams.get("sign"), signRequest({ environment: "production", partnerId: "1000", partnerKey: "key", path: "/api/v2/shop/auth_partner", timestamp: 1700000000 }));
});

test("production callback requires HTTPS", () => {
  assert.throws(() => authorizationUrl({ environment: "production", partnerId: "1000", partnerKey: "key", callbackUrl: "http://example.com/callback", state, timestamp: 1700000000 }));
});

test("signatures distinguish public calls from shop calls", () => {
  const config = { environment: "sandbox" as const, partnerId: "1000", partnerKey: "key", path: "/api/v2/order/get_order_list", timestamp: 1700000000 };
  // Independently calculated with Python hmac for the documented concatenation.
  assert.equal(signRequest(config), "644f87743880d250a662bbe8279d61a067637720cef2980c3267c9e43c32e6c5");
  assert.notEqual(signRequest(config), signRequest({ ...config, accessToken: "token", shopId: "123" }));
  assert.throws(() => signRequest({ ...config, accessToken: "token" }));
});

test("tokens are authenticated, randomized, and bound to a shop/environment", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const context = "sandbox:123:access";
  const cipher = encryptToken("secret-token", key, context);
  assert.equal(decryptToken(cipher, key, context), "secret-token");
  assert.notEqual(cipher, encryptToken("secret-token", key, context));
  assert.throws(() => decryptToken(cipher, key, "production:123:access"));
  assert.throws(() => decryptToken(cipher.replace("v1", "v2"), key, context));
  assert.throws(() => encryptToken("secret", "bad-key", context));
});

test("origin and return paths prevent cross-site mutation/open redirects", () => {
  assert.doesNotThrow(() => assertSameOrigin("https://datoko.example", "https://datoko.example"));
  assert.throws(() => assertSameOrigin("https://attacker.example", "https://datoko.example"));
  assert.throws(() => assertSameOrigin(null, "https://datoko.example"));
  assert.throws(() => assertSameOrigin("null", "https://datoko.example"));
  assert.throws(() => assertSameOrigin("http://127.0.0.1:3000", "http://localhost:3000"));
  assert.equal(safeReturnPath("https://attacker.example"), "/settings/integrations");
  assert.equal(safeReturnPath("//attacker.example"), "/settings/integrations");
});

test("source JSON preserves IDs that exceed JavaScript's safe integer range", () => {
  const parsed = parseSourceJson('{"item_id":9007199254740993,"total_amount":110000.125,"expire_in":14400}') as Record<string, unknown>;
  assert.equal(parsed.item_id, "9007199254740993");
  assert.equal(parsed.total_amount, "110000.125");
  assert.equal(parsed.expire_in, 14400);
  assert.throws(() => externalId(9007199254740993));
});
