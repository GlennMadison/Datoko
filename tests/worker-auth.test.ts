import { test } from "node:test";
import assert from "node:assert/strict";
import { validWorkerAuthorization } from "../src/core/worker-auth.ts";

const secret = "isolated-worker-test-secret-at-least-32-characters";
test("only the exact scoped worker bearer credential is accepted", () => {
  assert.equal(validWorkerAuthorization(`Bearer ${secret}`, secret), true);
  for (const header of [null, "", secret, `bearer ${secret}`, `Bearer ${secret} `, "Bearer wrong"]) assert.equal(validWorkerAuthorization(header, secret), false);
});
test("missing and weak worker credentials fail closed", () => {
  assert.equal(validWorkerAuthorization("Bearer undefined", undefined), false);
  assert.equal(validWorkerAuthorization("Bearer short", "short"), false);
});
