import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const auth = process.argv.includes("--auth");
const args = process.argv.slice(2).filter(arg => arg !== "--auth");
const env = { ...process.env, DATOKO_BROWSER_TEST_SERVER: "true", DATOKO_BROWSER_TEST_AUTH: String(auth), DATOKO_EXTERNAL_TEST_SERVER: "true", NODE_ENV: "production" };
let certificateDir;
if (auth) {
  const databaseUrl = env.TEST_DATABASE_URL;
  if (!databaseUrl || !new URL(databaseUrl).pathname.toLowerCase().includes("test")) throw new Error("Use a dedicated TEST_DATABASE_URL containing 'test'.");
  Object.assign(env, {
    DATABASE_URL: databaseUrl, DATOKO_MODE: "live", AUTH_METHOD: "email-password", EMAIL_SIGNUP_ENABLED: "true", SHOPEE_ENV: "sandbox",
    AUTH_E2E_OWNER_EMAIL: env.AUTH_E2E_OWNER_EMAIL ?? `auth-browser-${randomUUID()}@example.test`,
    APP_BASE_URL: "https://127.0.0.1:3101", BETTER_AUTH_URL: "https://127.0.0.1:3101",
    BETTER_AUTH_SECRET: "auth-browser-fixture-secret-more-than-32-characters",
    GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "",
  });
  delete env.OWNER_EMAIL;
  delete env.OWNER_GOOGLE_SUB;
  certificateDir = await mkdtemp(join(tmpdir(), "Datoko-browser-tls-"));
  env.DATOKO_TEST_TLS_KEY = join(certificateDir, "key.pem"); env.DATOKO_TEST_TLS_CERT = join(certificateDir, "cert.pem");
  const windowsOpenSSL = "C:/Program Files/Git/mingw64/bin/openssl.exe";
  const openssl = process.env.DATOKO_TEST_OPENSSL ?? (process.platform === "win32" && existsSync(windowsOpenSSL) ? windowsOpenSSL : "openssl");
  const generated = spawnSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", env.DATOKO_TEST_TLS_KEY, "-out", env.DATOKO_TEST_TLS_CERT, "-subj", "/CN=localhost", "-days", "1", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { windowsHide: true, stdio: "pipe" });
  if (generated.error || generated.status !== 0) {
    await Promise.allSettled([unlink(env.DATOKO_TEST_TLS_KEY), unlink(env.DATOKO_TEST_TLS_CERT)]); await rmdir(certificateDir);
    throw new Error("OpenSSL is required for the isolated HTTPS owner browser test server. Set DATOKO_TEST_OPENSSL if it is not on PATH.");
  }
} else Object.assign(env, { DATOKO_MODE: "demo", APP_BASE_URL: "http://127.0.0.1:3100" });

const server = spawn(process.execPath, ["scripts/browser-server.mjs"], { env, windowsHide: true, stdio: ["ignore", "inherit", "inherit", "ipc"] });
let runner;
async function stop() {
  if (runner && runner.exitCode === null && runner.signalCode === null) runner.kill();
  if (server.exitCode !== null || server.signalCode !== null) return;
  const exited = once(server, "exit");
  if (server.connected) server.send("shutdown");
  const timer = setTimeout(() => server.kill(), 7000);
  try { await exited; } finally { clearTimeout(timer); }
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void stop().then(() => process.exit(130)); });
let code = 1;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Test server did not start within 90 seconds.")), 90_000);
    server.once("error", error => { clearTimeout(timer); reject(error); });
    server.once("exit", () => { clearTimeout(timer); reject(new Error("Test server exited before it was ready.")); });
    server.once("message", message => { if (message?.ready) { clearTimeout(timer); resolve(); } });
  });
  runner = spawn(process.execPath, ["node_modules/playwright/cli.js", "test", ...(auth ? ["--config", "playwright.auth.config.ts"] : []), ...args], { env, windowsHide: true, stdio: "inherit" });
  const [exitCode] = await once(runner, "exit");
  code = exitCode ?? 1;
} finally {
  await stop();
  if (certificateDir) { await unlink(env.DATOKO_TEST_TLS_KEY); await unlink(env.DATOKO_TEST_TLS_CERT); await rmdir(certificateDir); }
}
process.exitCode = code;
