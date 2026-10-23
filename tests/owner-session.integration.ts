import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.toLowerCase().includes("test")) throw new Error("Use a dedicated TEST_DATABASE_URL containing 'test'.");
const fixture = randomUUID();
const secret = "owner-session-fixture-secret-more-than-32-characters";
const ownerEmail = `owner-${fixture}@example.test`;
Object.assign(process.env, {
  DATABASE_URL: databaseUrl, DATOKO_MODE: "live", APP_BASE_URL: "https://owner-session.example.test",
  BETTER_AUTH_SECRET: secret, AUTH_METHOD: "google", GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: "fixture-secret", OWNER_EMAIL: ownerEmail,
});
delete process.env.OWNER_GOOGLE_SUB;
const { getDb, closeDb } = await import("../src/server/db.ts");
const { getAuth, requireUser } = await import("../src/server/auth.ts");

// Seed sessions only in the dedicated test database. This verifies the actual
// Better Auth adapter and backend session checks without bypassing production
// login or pretending that Google's interactive OAuth flow was tested.
test("real auth adapter authenticates separate verified Google accounts", async t => {
  const db = getDb();
  const ownerId = `owner-${fixture}`;
  const outsiderId = `outsider-${fixture}`;
  t.after(async () => {
    try { await db.user.deleteMany({ where: { id: { in: [ownerId, outsiderId] } } }); }
    finally { await closeDb(); }
  });
  await db.user.createMany({ data: [
    { id: ownerId, name: "Owner fixture", email: ownerEmail, emailVerified: true },
    { id: outsiderId, name: "Other fixture", email: `other-${fixture}@example.test`, emailVerified: true },
  ] });
  await db.account.createMany({ data: [
    { id: randomUUID(), userId: ownerId, providerId: "google", accountId: `google-owner-${fixture}` },
    { id: randomUUID(), userId: outsiderId, providerId: "google", accountId: `google-other-${fixture}` },
  ] });
  const auth = getAuth();
  const context = await auth.$context;
  const sessionHeaders = async (userId: string, expiresAt = new Date(Date.now() + 3_600_000)) => {
    const token = randomUUID();
    const session = await db.session.create({ data: { id: randomUUID(), token, userId, expiresAt } });
    const signature = createHmac("sha256", secret).update(token).digest("base64");
    const headers = new Headers({ Cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}`, Origin: process.env.APP_BASE_URL! });
    return { headers, session };
  };
  const owner = await sessionHeaders(ownerId);

  await t.test("a verified owner session resolves through the Prisma adapter", async () => {
    assert.deepEqual(await requireUser(new Headers(owner.headers)), { ownerId, sessionId: owner.session.id, name: "Owner fixture" });
  });
  await t.test("missing and tampered signed sessions are rejected", async () => {
    await assert.rejects(requireUser(new Headers()), { code: "SIGN_IN_REQUIRED" });
    const tampered = new Headers(owner.headers);
    tampered.set("cookie", `${context.authCookies.sessionToken.name}=invalid-session.invalid-signature`);
    await assert.rejects(requireUser(tampered), { code: "SIGN_IN_REQUIRED" });
  });
  await t.test("another verified Google account resolves to its own user", async () => {
    const outsider = await sessionHeaders(outsiderId);
    assert.equal((await requireUser(outsider.headers)).ownerId, outsiderId);
  });
  await t.test("the owner's email must remain verified", async () => {
    await db.user.update({ where: { id: ownerId }, data: { emailVerified: false } });
    try { await assert.rejects(requireUser(new Headers(owner.headers)), { code: "AUTH_METHOD_REQUIRED" }); }
    finally { await db.user.update({ where: { id: ownerId }, data: { emailVerified: true } }); }
  });
  await t.test("Google mode requires an account linked to that user", async () => {
    await db.account.deleteMany({ where: { userId: outsiderId, providerId: "google" } });
    const outsider = await sessionHeaders(outsiderId);
    await assert.rejects(requireUser(outsider.headers), { code: "AUTH_METHOD_REQUIRED" });
    await db.account.create({ data: { id: randomUUID(), userId: outsiderId, providerId: "google", accountId: `restored-${fixture}` } });
    assert.equal((await requireUser(outsider.headers)).ownerId, outsiderId);
  });
  await t.test("expired sessions cannot authenticate", async () => {
    const expired = await sessionHeaders(ownerId, new Date(0));
    await assert.rejects(requireUser(expired.headers), { code: "SIGN_IN_REQUIRED" });
  });
  await t.test("sign-out revokes the saved session", async () => {
    await auth.api.signOut({ headers: new Headers(owner.headers) });
    assert.equal(await db.session.count({ where: { id: owner.session.id } }), 0);
    await assert.rejects(requireUser(new Headers(owner.headers)), { code: "SIGN_IN_REQUIRED" });
  });
});
