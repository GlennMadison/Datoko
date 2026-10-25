import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.toLowerCase().includes("test")) throw new Error("Use a dedicated test database.");

test("separate accounts keep shop data and mutations private", async ({ page, browser, baseURL }, testInfo) => {
  const pool = new Pool({ connectionString: databaseUrl });
  const fixture = randomUUID();
  const emails = [`seller-a-${fixture}@example.test`, `seller-b-${fixture}@example.test`];
  const password = "multiuser-browser-password-2026";
  const shopIds = [randomUUID(), randomUUID()], variantIds = [randomUUID(), randomUUID()];
  const jobIds = [randomUUID(), randomUUID()], sns = [`PRIVATE-A-${fixture}`, `PRIVATE-B-${fixture}`];
  const names = ["Seller Alpha", "Seller Beta"], products = [`Alpha product ${fixture}`, `Beta product ${fixture}`];
  const otherContext = await browser.newContext({ baseURL, ignoreHTTPSErrors: true, extraHTTPHeaders: { "X-Forwarded-For": testInfo.project.name === "mobile" ? "192.0.2.32" : "192.0.2.31" } });
  const otherPage = await otherContext.newPage();
  const pages = [page, otherPage];
  try {
    for (let index = 0; index < 2; index++) {
      const signup = await pages[index].request.post("/api/auth/sign-up/email", { headers: { Origin: baseURL! }, data: { name: names[index], email: emails[index], password } });
      expect(signup.status()).toBe(200);
      const userId = (await signup.json()).user.id;
      await pool.query('INSERT INTO shops (id,"ownerId","sourceShopId",environment,name,"updatedAt") VALUES ($1,$2,$3,\'sandbox\',$4,now())', [shopIds[index], userId, `${Date.now()}${index}`, `Private shop ${names[index]}`]);
      await pool.query('INSERT INTO product_variants (id,"shopId","sourceItemId","sourceModelId",name,"updatedAt") VALUES ($1,$2,\'1\',\'0\',$3,now())', [variantIds[index], shopIds[index], products[index]]);
      const orderId = randomUUID();
      await pool.query('INSERT INTO orders (id,"shopId","orderSn",status,"totalAmount","merchandiseAmount","sourceCreatedAt","sourceUpdatedAt") VALUES ($1,$2,$3,\'COMPLETED\',100000,100000,now(),now())', [orderId, shopIds[index], sns[index]]);
      await pool.query('INSERT INTO order_items (id,"orderId","sourceLineKey","variantId",name,quantity,"originalUnitPrice","paidUnitPrice") VALUES ($1,$2,\'line:1\',$3,$4,1,100000,100000)', [randomUUID(), orderId, variantIds[index], products[index]]);
      await pool.query('INSERT INTO sync_runs (id,"shopId","jobId",reason,status,generation,processed,"finishedAt") VALUES ($1,$2,$3,\'MANUAL\',\'SUCCEEDED\',1,1,now())', [randomUUID(), shopIds[index], jobIds[index]]);
    }
    for (let index = 0; index < 2; index++) {
      await pages[index].goto("/orders");
      await expect(pages[index].getByRole("link", { name: products[index], exact: true })).toBeVisible();
      await expect(pages[index].getByRole("link", { name: products[1 - index], exact: true })).toHaveCount(0);
      if (!await pages[index].getByText(names[index], { exact: true }).isVisible()) await pages[index].getByRole("button", { name: "Toggle sidebar", exact: true }).click();
      await expect(pages[index].getByText(names[index], { exact: true })).toBeVisible();
    }
    const headers = { Origin: baseURL! };
    expect((await page.request.post(`/api/shops/${shopIds[1]}/sync`, { headers })).status()).toBe(404);
    expect((await page.request.post("/api/integrations/shopee/disconnect", { headers, form: { shopId: shopIds[1] } })).status()).toBe(404);
    expect((await page.request.post(`/api/variants/${variantIds[1]}/costs`, { headers, form: { amount: "100", note: "forbidden" } })).status()).toBe(404);
    expect((await page.request.get(`/api/sync/jobs/${jobIds[1]}`)).status()).toBe(404);
    expect((await page.request.get(`/api/sync/jobs/${jobIds[0]}`)).status()).toBe(200);
    const ownTemplate = await page.request.get("/api/advertisement/template");
    expect(ownTemplate.status()).toBe(200);
    const template = await ownTemplate.json();
    const foreignShop = (await pool.query('SELECT "sourceShopId" FROM shops WHERE id=$1', [shopIds[1]])).rows[0];
    expect((await page.request.post("/api/advertisement/import", { headers, data: { ...template, sourceShopId: foreignShop.sourceShopId } })).status()).toBe(404);
    await page.goto(`/orders/${sns[1]}`);
    await expect(page.getByRole("heading", { name: "Page not found", exact: true })).toBeVisible();
    await expect(page.getByText(products[1], { exact: true })).toHaveCount(0);
    expect((await pool.query('SELECT count(*)::int AS count FROM sku_cost_versions WHERE "variantId"=$1', [variantIds[1]])).rows[0].count).toBe(0);
    expect((await page.request.post("/api/auth/sign-out", { headers, data: {} })).status()).toBe(200);
    expect((await page.request.get("/api/advertisement/template")).status()).toBe(401);
    expect((await otherPage.request.get("/api/advertisement/template")).status()).toBe(200);
    expect((await page.request.post("/api/auth/sign-in/email", { headers, data: { email: emails[0], password } })).status()).toBe(200);
    await page.goto("/orders");
    await expect(page.getByRole("link", { name: products[0], exact: true })).toBeVisible();
  } finally {
    await otherContext.close();
    await pool.query('DELETE FROM sync_runs WHERE "shopId"=ANY($1::text[])', [shopIds]);
    await pool.query('DELETE FROM order_items WHERE "orderId" IN (SELECT id FROM orders WHERE "shopId"=ANY($1::text[]))', [shopIds]);
    await pool.query('DELETE FROM orders WHERE "shopId"=ANY($1::text[])', [shopIds]);
    await pool.query('DELETE FROM product_variants WHERE "shopId"=ANY($1::text[])', [shopIds]);
    await pool.query('DELETE FROM shops WHERE id=ANY($1::text[])', [shopIds]);
    await pool.query('DELETE FROM users WHERE email=ANY($1::text[])', [emails]);
    await pool.end();
  }
});
