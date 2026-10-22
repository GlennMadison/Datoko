// Test-only server: IPC lets its parent close it without Windows taskkill trees.
import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { readFileSync } from "node:fs";
import next from "next";

if (process.env.DATOKO_BROWSER_TEST_SERVER !== "true" || !process.send) throw new Error("Launch through run-browser-tests.mjs.");
const auth = process.env.DATOKO_BROWSER_TEST_AUTH === "true";
const port = auth ? 3101 : 3100;
const app = next({ dev: false, webpack: true, hostname: "127.0.0.1", port });
await app.prepare();
const handle = app.getRequestHandler();
const listener = (request, response) => { handle(request, response).catch(() => { response.statusCode = 500; response.end(); }); };
const server = auth ? createSecureServer({ key: readFileSync(process.env.DATOKO_TEST_TLS_KEY), cert: readFileSync(process.env.DATOKO_TEST_TLS_CERT) }, listener) : createServer(listener);
server.on("upgrade", app.getUpgradeHandler());
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
process.send({ ready: true });
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => process.exit(1), 5000);
  timer.unref();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await app.close();
  process.exit(0);
}
process.on("message", message => { if (message === "shutdown") void shutdown(); });
process.on("disconnect", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
