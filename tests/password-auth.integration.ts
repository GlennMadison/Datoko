import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.toLowerCase().includes("test")) throw new Error("Use a dedicated TEST_DATABASE_URL containing 'test'.");
const fixture = randomUUID();
const ownerEmail = `password-owner-${fixture}@example.test`;
const otherEmail = `password-other-${fixture}@example.test`;
const origin = "https://password-auth.example.test";
const password = "local-owner-password-2026";
Object.assign(process.env, {
  DATABASE_URL: databaseUrl, DATOKO_MODE: "live", APP_BASE_URL: origin,
  BETTER_AUTH_SECRET: "password-auth-fixture-secret-more-than-32-characters",
  AUTH_METHOD: "email-password", EMAIL_SIGNUP_ENABLED: "true", OWNER_EMAIL: ownerEmail,
});
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.OWNER_GOOGLE_SUB;
const { getDb, closeDb } = await import("../src/server/db.ts");
const { getAuth, requireUser } = await import("../src/server/auth.ts");
const { loginMissing, connectionMissing } = await import("../src/server/env.ts");

test("email/password auth uses real SQL accounts and signed sessions", async t => {
  const db = getDb();
  const auth = getAuth();
  t.after(async () => {
    try { await db.user.deleteMany({ where: { email: { in: [ownerEmail, otherEmail] } } }); }
    finally { await closeDb(); }
  });
  function request(path: string, body?: Record<string, unknown>, cookie?: string) {
    return auth.handler(new Request(`${origin}/api/auth${path}`, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "192.0.2.11", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
  }
  function cookieOf(response: Response) { return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); }
  let ownerId = "";
  let signedCookie = "";

  await t.test("login config does not need an owner email, Google, or Shopee credentials", async () => {
    delete process.env.OWNER_EMAIL;
    assert.deepEqual(loginMissing(), []);
    assert.ok(!connectionMissing().includes("GOOGLE_CLIENT_ID"));
    assert.ok(!connectionMissing().includes("GOOGLE_CLIENT_SECRET"));
    const ok = await request("/ok");
    assert.equal(ok.status, 200);
  });
  await t.test("short passwords create no account", async () => {
    assert.equal((await request("/sign-up/email", { email: ownerEmail, name: "Owner", password: "short" })).status, 400);
    assert.equal(await db.user.count({ where: { email: { in: [ownerEmail, otherEmail] } } }), 0);
  });
  await t.test("signup stores a password hash and authenticates without email verification", async () => {
    const response = await request("/sign-up/email", { email: ownerEmail.toUpperCase(), name: "Password owner", password });
    assert.equal(response.status, 200);
    const body = await response.json();
    ownerId = body.user.id;
    assert.equal(body.user.emailVerified, false);
    assert.equal(body.user.email, ownerEmail);
    assert.ok(!JSON.stringify(body).includes(password));
    const account = await db.account.findFirstOrThrow({ where: { userId: ownerId, providerId: "credential" } });
    assert.ok(account.password);
    assert.notEqual(account.password, password);
    signedCookie = cookieOf(response);
    assert.match(signedCookie, /session_token/);
    const owner = await requireUser(new Headers({ Cookie: signedCookie }));
    assert.equal(owner.ownerId, ownerId);
  });
  await t.test("duplicate signup and incorrect passwords cannot replace the owner account", async () => {
    const duplicate = await request("/sign-up/email", { email: ownerEmail, name: "Replacement", password: "replacement-password-2026" });
    assert.equal(duplicate.status, 422);
    assert.equal(await db.user.count({ where: { email: ownerEmail } }), 1);
    const wrong = await request("/sign-in/email", { email: ownerEmail, password: "wrong-password-2026" });
    assert.equal(wrong.status, 401);
    assert.ok(!cookieOf(wrong).includes("session_token="));
  });
  await t.test("signout revokes access and login issues a new valid session", async () => {
    assert.equal((await request("/sign-out", {}, signedCookie)).status, 200);
    await assert.rejects(requireUser(new Headers({ Cookie: signedCookie })), { code: "SIGN_IN_REQUIRED" });
    const login = await request("/sign-in/email", { email: ownerEmail, password });
    assert.equal(login.status, 200);
    signedCookie = cookieOf(login);
    assert.equal((await requireUser(new Headers({ Cookie: signedCookie }))).ownerId, ownerId);
  });
  await t.test("a different email can sign up and log in to its own session", async () => {
    const response = await request("/sign-up/email", { email: otherEmail, name: "Another seller", password, emailVerified: true });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.notEqual(body.user.id, ownerId);
    assert.equal(body.user.emailVerified, false);
    const cookie = cookieOf(response);
    assert.equal((await requireUser(new Headers({ Cookie: cookie }))).ownerId, body.user.id);
    assert.equal((await requireUser(new Headers({ Cookie: signedCookie }))).ownerId, ownerId);
    assert.equal((await request("/sign-out", {}, cookie)).status, 200);
    const login = await request("/sign-in/email", { email: otherEmail, password });
    assert.equal(login.status, 200);
    assert.equal((await requireUser(new Headers({ Cookie: cookieOf(login) }))).ownerId, body.user.id);
    assert.equal((await requireUser(new Headers({ Cookie: signedCookie }))).ownerId, ownerId);
  });
  await t.test("cross-site signup is rejected before creating records", async () => {
    const response = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://other.example.test" },
      body: JSON.stringify({ email: otherEmail, name: "Other", password }),
    }));
    assert.equal(response.status, 403);
  });
  await t.test("login rate limits are shared across auth instances", async () => {
    const { betterAuth } = await import("better-auth");
    const secondInstance = betterAuth(auth.options);
    let status = 0;
    for (let attempt = 0; attempt < 11 && status !== 429; attempt++) {
      const instance = attempt % 2 ? secondInstance : auth;
      status = (await instance.handler(new Request(`${origin}/api/auth/sign-in/email`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "X-Forwarded-For": "192.0.2.11" },
        body: JSON.stringify({ email: ownerEmail, password: "incorrect-password-2026" }),
      }))).status;
    }
    assert.equal(status, 429);
  });
});
