import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

test("attention is shop scoped, ignores report dates, and clears after fixes", async ({ page, baseURL, browser }, testInfo) => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl || !new URL(databaseUrl).pathname.toLowerCase().includes("test")) throw new Error("Use a dedicated test database.");
  const pool = new Pool({ connectionString: databaseUrl });
  const shopId = randomUUID(), variantId = randomUUID(), saleId = randomUUID();
  const pending = randomUUID(), email = pending + "@example.test";
  const otherEmail = randomUUID() + "@example.test";
  const fixtureIp = testInfo.project.name === "mobile" ? 43 : 41;
  const password = "datoko-attention-browser-password";
  try {
    const signup = await page.request.post("/api/auth/sign-up/email", { headers: { Origin: baseURL!, "X-Forwarded-For": "192.0.2." + fixtureIp }, data: { name: "Attention shop", email, password } });
    expect(signup.status()).toBe(200);
    const owner = (await signup.json()).user.id;
    await pool.query(`INSERT INTO shops (id,"ownerId","sourceShopId",environment,name,"updatedAt")
      VALUES ($1,$2,$1,'sandbox','Attention shop',now())`, [shopId, owner]);
    await pool.query(`INSERT INTO shop_connections (id,"shopId","updatedAt") VALUES ($1,$2,now())`, [randomUUID(), shopId]);
    await pool.query(`INSERT INTO sync_states (id,"shopId",resource,"lastErrorCode","updatedAt")
      VALUES ($1,$2,'orders','TEST_FAILURE',now())`, [randomUUID(), shopId]);
    await pool.query(`INSERT INTO product_variants (id,"shopId","sourceItemId","sourceModelId",name,"updatedAt")
      VALUES ($1,$2,'1','0','Test stand',now())`, [variantId, shopId]);

    for (const [id, serial, status, payment, minutes] of [
      [pending, pending, "READY_TO_SHIP", "PAID", 180],
      [randomUUID(), randomUUID(), "READY_TO_SHIP", "PAID", 5],
      [randomUUID(), randomUUID(), "READY_TO_SHIP", "UNPAID", null],
      [randomUUID(), randomUUID(), "PROCESSED", "PAID", 180],
      [saleId, saleId, "COMPLETED", "PAID", 180],
    ]) {
      await pool.query(`INSERT INTO orders (id,"shopId","orderSn",status,"paymentStatus","paidAt","totalAmount","merchandiseAmount","sourceCreatedAt","sourceUpdatedAt")
        VALUES ($1,$2,$3,$4,$5,now()-make_interval(mins => $6::int),100000,100000,now()-interval '4 hours',now())`,
      [id, shopId, serial, status, payment, minutes]);
    }
    await pool.query(`INSERT INTO order_items (id,"orderId","sourceLineKey","variantId",name,quantity,"originalUnitPrice","paidUnitPrice")
      VALUES ($1,$2,'line',$3,'Test stand',1,100000,100000)`, [randomUUID(), saleId, variantId]);

    await page.goto("/overview?preset=today");
    const panel = page.getByRole("region", { name: "Needs attention" });
    await expect(panel.getByRole("link", { name: "Orders awaiting processing 1" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Variants missing COGS 1" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Order sync failed" })).toHaveAttribute("href", "/settings/sync");
    await page.goto("/overview?preset=last7");
    await panel.getByRole("link", { name: "Orders awaiting processing 1" }).click();
    await expect(page.getByRole("link", { name: pending })).toHaveAttribute("href", `/orders/${pending}`);
    await expect(page.locator("main ul li")).toHaveCount(1);

    const other = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const otherPage = await other.newPage();
      const signup = await otherPage.request.post(baseURL + "/api/auth/sign-up/email", { headers: { Origin: baseURL!, "X-Forwarded-For": "192.0.2." + (fixtureIp + 1) },
        data: { name: "Other user", email: otherEmail, password } });
      expect(signup.status()).toBe(200);
      await otherPage.goto(baseURL + "/overview/attention?kind=orders");
      await expect(otherPage.getByText("Connect a shop to see current issues.")).toBeVisible();
      await expect(otherPage.getByRole("link", { name: pending })).toHaveCount(0);
    } finally {
      await other.close();
    }

    await page.goto("/overview");
    await panel.getByRole("link", { name: "Variants missing COGS 1" }).click();
    await page.getByRole("spinbutton", { name: "New cost for Test stand" }).fill("56725");
    await page.getByRole("button", { name: "Save cost" }).click();
    await expect(page.getByText("All caught up.")).toBeVisible();
    await pool.query("UPDATE orders SET status='PROCESSED' WHERE id=$1", [pending]);
    await pool.query(`UPDATE sync_states SET "lastSuccessAt"=now(), "lastErrorCode"=NULL, "updatedAt"=now()
      WHERE "shopId"=$1`, [shopId]);
    await page.getByRole("link", { name: "Back to Overview" }).click();
    await expect(panel.getByText("All caught up.")).toBeVisible();
  } finally {
    await pool.query('DELETE FROM sku_cost_versions WHERE "variantId"=$1', [variantId]);
    await pool.query('DELETE FROM order_items WHERE "orderId"=$1', [saleId]);
    await pool.query('DELETE FROM orders WHERE "shopId"=$1', [shopId]);
    await pool.query('DELETE FROM product_variants WHERE "shopId"=$1', [shopId]);
    await pool.query('DELETE FROM sync_states WHERE "shopId"=$1', [shopId]);
    await pool.query('DELETE FROM shop_connections WHERE "shopId"=$1', [shopId]);
    await pool.query('DELETE FROM shops WHERE id=$1', [shopId]);
    await pool.query('DELETE FROM users WHERE email IN ($1,$2)', [email, otherEmail]);
    await pool.end();
  }
});
