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
const { getAuth, requireOwner } = await import("../src/server/auth.ts");

// Seed sessions only in the dedicated test database. This verifies the actual
// Better Auth adapter and backend owner checks without bypassing production
// login or pretending that Google's interactive OAuth flow was tested.
test("real auth adapter enforces private owner sessions", async t => {
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
    assert.deepEqual(await requireOwner(new Headers(owner.headers)), { ownerId, sessionId: owner.session.id, name: "Owner fixture" });
  });
  await t.test("missing and tampered signed sessions are rejected", async () => {
    await assert.rejects(requireOwner(new Headers()), { code: "SIGN_IN_REQUIRED" });
    const tampered = new Headers(owner.headers);
    tampered.set("cookie", `${context.authCookies.sessionToken.name}=invalid-session.invalid-signature`);
    await assert.rejects(requireOwner(tampered), { code: "SIGN_IN_REQUIRED" });
  });
  await t.test("a valid session belonging to another user cannot read owner data", async () => {
    const outsider = await sessionHeaders(outsiderId);
    await assert.rejects(requireOwner(outsider.headers), { code: "OWNER_ONLY" });
  });
  await t.test("the owner's email must remain verified", async () => {
    await db.user.update({ where: { id: ownerId }, data: { emailVerified: false } });
    try { await assert.rejects(requireOwner(new Headers(owner.headers)), { code: "OWNER_ONLY" }); }
    finally { await db.user.update({ where: { id: ownerId }, data: { emailVerified: true } }); }
  });
  await t.test("Google subject pinning requires the exact linked owner account", async () => {
    process.env.OWNER_GOOGLE_SUB = "fixture-trusted-subject";
    try {
      await assert.rejects(requireOwner(new Headers(owner.headers)), { code: "OWNER_ONLY" });
      await db.account.create({ data: { id: randomUUID(), userId: ownerId, providerId: "google", accountId: "fixture-trusted-subject" } });
      assert.equal((await requireOwner(new Headers(owner.headers))).ownerId, ownerId);
    } finally { delete process.env.OWNER_GOOGLE_SUB; }
  });
  await t.test("expired sessions cannot authenticate", async () => {
    const expired = await sessionHeaders(ownerId, new Date(0));
    await assert.rejects(requireOwner(expired.headers), { code: "SIGN_IN_REQUIRED" });
  });
  await t.test("sign-out revokes the saved session", async () => {
    await auth.api.signOut({ headers: new Headers(owner.headers) });
    assert.equal(await db.session.count({ where: { id: owner.session.id } }), 0);
    await assert.rejects(requireOwner(new Headers(owner.headers)), { code: "SIGN_IN_REQUIRED" });
  });
});
