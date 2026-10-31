import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.toLowerCase().includes("test")) throw new Error("Use a dedicated test database.");

test("report caches invalidate on refresh and sync changes; idle status checks do not reload reports", async ({ page, baseURL }) => {
  const pool = new Pool({ connectionString: databaseUrl }), fixture = randomUUID(), email = fixture + "@example.test";
  const shopId = randomUUID(), variantId = randomUUID(), orderId = randomUUID();
  try {
    const signup = await page.request.post("/api/auth/sign-up/email", { headers: { Origin: baseURL! }, data: { name: "Cache fixture", email, password: "database-usage-browser-password-2026" } });
    expect(signup.status()).toBe(200);
    const userId = (await signup.json()).user.id;
    await pool.query('INSERT INTO shops (id,"ownerId","sourceShopId",environment,name,"updatedAt") VALUES ($1,$2,$3,\'sandbox\',\'Cache fixture\',now())', [shopId, userId, fixture]);
    await pool.query('INSERT INTO product_variants (id,"shopId","sourceItemId","sourceModelId",name,"updatedAt") VALUES ($1,$2,\'1\',\'0\',\'Cache product\',now())', [variantId, shopId]);
    await pool.query('INSERT INTO orders (id,"shopId","orderSn",status,"paymentStatus","totalAmount","merchandiseAmount","sourceCreatedAt","sourceUpdatedAt") VALUES ($1,$2,$3,\'COMPLETED\',\'PAID\',100000,100000,now(),now())', [orderId, shopId, fixture]);
    await pool.query('INSERT INTO order_items (id,"orderId","sourceLineKey","variantId",name,quantity,"originalUnitPrice","paidUnitPrice") VALUES ($1,$2,\'line\',$3,\'Cache product\',1,100000,100000)', [randomUUID(), orderId, variantId]);
    await page.goto("/overview?preset=today");
    const sales = page.locator(".metrics-grid .metric").first().locator(".metric-value");
    await expect(sales).toContainText("100.000");
    await pool.query('UPDATE orders SET "merchandiseAmount"=123456 WHERE id=$1', [orderId]);
    await page.reload();
    await expect(sales).toContainText("100.000");
    expect((await page.request.post("/api/workspace/refresh", { headers: { Origin: "https://foreign.example" } })).status()).toBe(403);
    await page.getByRole("button", { name: "Refresh report", exact: true }).click();
    await expect(sales).toContainText("123.456");
    await pool.query('UPDATE orders SET "merchandiseAmount"=140000 WHERE id=$1', [orderId]);
    await pool.query('INSERT INTO sync_states (id,"shopId",resource,"lastSuccessAt","updatedAt") VALUES ($1,$2,\'orders\',now(),now())', [randomUUID(), shopId]);
    await page.reload();
    await expect(sales).toContainText("140.000");
    const statusResponse = await page.request.get("/api/workspace/status");
    expect(statusResponse.headers()["cache-control"]).toContain("no-store");
    const status = await statusResponse.json();
    expect(Object.keys(status).sort()).toEqual(["active", "connected", "version"]);

    // Advance only the browser clock: database sessions and financial dates are untouched.
    await page.clock.install();
    let checks = 0, renders = 0;
    page.on("request", request => { if (request.headers()["rsc"] === "1") renders++; });
    await page.route("**/api/workspace/status", async route => { checks++; await route.fulfill({ json: status }); });
    await page.reload();
    await expect(sales).toContainText("140.000");
    renders = 0;
    await page.clock.fastForward(119_000);
    expect(checks).toBe(0);
    await page.clock.fastForward(2_000);
    await expect.poll(() => checks).toBe(1);
    expect(renders).toBe(0);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.fastForward(600_000);
    expect(checks).toBe(1);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => checks).toBe(2);
    expect(renders).toBe(0);
  } finally {
    await pool.query('DELETE FROM sync_states WHERE "shopId"=$1', [shopId]);
    await pool.query('DELETE FROM order_items WHERE "orderId"=$1', [orderId]);
    await pool.query('DELETE FROM orders WHERE id=$1', [orderId]);
    await pool.query('DELETE FROM product_variants WHERE id=$1', [variantId]);
    await pool.query('DELETE FROM shops WHERE id=$1', [shopId]);
    await pool.query('DELETE FROM users WHERE email=$1', [email]);
    await pool.end();
  }
});
