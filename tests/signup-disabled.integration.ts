import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.toLowerCase().includes("test")) throw new Error("Use a dedicated TEST_DATABASE_URL containing 'test'.");
const ownerEmail = `closed-signup-${randomUUID()}@example.test`;
const origin = "https://closed-signup.example.test";
Object.assign(process.env, {
  DATABASE_URL: databaseUrl, DATOKO_MODE: "live", APP_BASE_URL: origin,
  BETTER_AUTH_SECRET: "closed-signup-fixture-secret-more-than-32-characters",
  AUTH_METHOD: "email-password", EMAIL_SIGNUP_ENABLED: "false", OWNER_EMAIL: ownerEmail,
});
const { getDb, closeDb } = await import("../src/server/db.ts");
const { getAuth, requireUser } = await import("../src/server/auth.ts");
test("closed registration blocks signup while preserving existing login", async t => {
  t.after(async () => {
    try { await getDb().user.deleteMany({ where: { email: ownerEmail } }); }
    finally { await closeDb(); }
  });
  const auth = getAuth();
  const response = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "X-Forwarded-For": "192.0.2.12" },
    body: JSON.stringify({ email: ownerEmail, name: "Owner", password: "closed-signup-password-2026" }),
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "EMAIL_PASSWORD_SIGN_UP_DISABLED");
  assert.equal(await getDb().user.count({ where: { email: ownerEmail } }), 0);
  const ownerId = randomUUID();
  const password = "existing-owner-password-2026";
  const hash = await (await auth.$context).password.hash(password);
  await getDb().user.create({ data: { id: ownerId, name: "Existing owner", email: ownerEmail } });
  await getDb().account.create({ data: { id: randomUUID(), userId: ownerId, providerId: "credential", accountId: ownerId, password: hash } });
  const login = await auth.handler(new Request(`${origin}/api/auth/sign-in/email`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "X-Forwarded-For": "192.0.2.12" },
    body: JSON.stringify({ email: ownerEmail, password }),
  }));
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert.equal((await requireUser(new Headers({ Cookie: cookie }))).ownerId, ownerId);
});
