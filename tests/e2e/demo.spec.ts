import { test, expect } from "@playwright/test";

test("dashboard pages render and navigate without browser errors", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("No Shopee shop is connected.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync now" })).toBeDisabled();
  await page.getByRole("button", { name: /^Date range:/ }).click();
  await page.getByRole("dialog", { name: "Choose reporting dates" }).getByRole("button", { name: "Last 7 days", exact: true }).click();
  await expect(page).toHaveURL(/preset=last7/);
  await expect(page.getByRole("button", { name: "Date range: Last 7 days", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Reporting period" }).getByLabel("Graph interval")).toBeVisible();
  await expect(page.getByRole("region", { name: "Sales chart" }).getByLabel("Graph interval")).toHaveCount(0);
  const metrics = await page.locator(".metrics-grid").boundingBox();
  const toolbar = await page.getByRole("region", { name: "Reporting period" }).boundingBox();
  const chart = await page.getByRole("region", { name: "Sales chart" }).boundingBox();
  expect(metrics!.y + metrics!.height).toBeLessThanOrEqual(toolbar!.y);
  expect(toolbar!.y + toolbar!.height).toBeLessThanOrEqual(chart!.y);
  await page.screenshot({ path: testInfo.outputPath("overview.png"), fullPage: true });
  for (const [route, heading] of [
    ["/orders", "Orders"],
    ["/products", "Products & costs"],
    ["/returns", "Returns"],
    ["/advertisement", "Advertisement"],
    ["/settings/integrations", "Connections"],
    ["/settings/sync", "Sync history"],
  ]) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (["/orders", "/products", "/returns", "/advertisement"].includes(route)) {
      await expect(page.getByRole("region", { name: "Reporting period" }).getByLabel("Graph interval")).toBeVisible();
      await expect(page.getByRole("region", { name: /chart$/ }).getByLabel("Graph interval")).toHaveCount(0);
    }
  }
  expect(errors).toEqual([]);
});

test("order filters, order detail, and missing-order state work", async ({ page }) => {
  await page.goto("/orders");
  await expect(page.locator("tbody tr")).toHaveCount(12);
  await page.getByLabel("Search orders").fill("SPK-BLK");
  await page.getByLabel("Order status").selectOption("COMPLETED");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("link", { name: "Desktop speaker stand", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Purchased items" })).toBeVisible();
  await page.getByRole("link", { name: /Back to orders/ }).click();
  await expect(page).toHaveURL(/\/orders$/);
  const response = await page.goto("/orders/ORDER-DOES-NOT-EXIST");
  expect(response?.status()).toBe(404);
});

test("demo controls are read-only and unavailable integrations are labeled", async ({ page }) => {
  await page.goto("/products");
  for (const button of await page.getByRole("button", { name: "Save cost" }).all()) await expect(button).toBeDisabled();
  await page.goto("/settings/integrations");
  await expect(page.getByRole("button", { name: "Connect Shopee" })).toBeDisabled();
  await expect(page.getByText("No live shop connected", { exact: true })).toBeVisible();
  await page.goto("/returns");
  await expect(page.getByRole("heading", { name: "Return cases", exact: true })).toBeVisible();
  await expect(page.getByText("Sample case", { exact: true })).toBeVisible();
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Email", { exact: true })).toBeDisabled();
  await page.getByRole("link", { name: "Create your account" }).click();
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeDisabled();
  await page.getByRole("link", { name: "View setup requirements" }).click();
  await expect(page.getByRole("heading", { name: "Setup" })).toBeVisible();
});

test("native same-origin forms preserve their origin and reach the demo guard", async ({ page }) => {
  await page.goto("/settings/integrations");
  const submitted = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === "/api/integrations/shopee/connect");
  const response = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/integrations/shopee/connect");
  // Demo disables its controls, so submit the real native form directly. No
  // Origin header is injected: Chromium must generate it from the page policy.
  await page.locator('form[action="/api/integrations/shopee/connect"]').evaluate(form => (form as HTMLFormElement).submit());
  expect((await submitted).headers().origin).toBe("http://127.0.0.1:3100");
  const result = await response;
  expect(result.status()).toBe(409);
  expect(await result.json()).toMatchObject({ error: "DEMO_READ_ONLY" });
  expect(result.headers()["referrer-policy"]).toBe("no-referrer");
});

test("server rejects cross-site and demo mutations", async ({ request }) => {
  for (const origin of ["https://other.example.test", "null"]) {
    const crossSite = await request.post("/api/integrations/shopee/connect", { headers: { Origin: origin }, form: { shopId: "123" }, maxRedirects: 0 });
    expect(crossSite.status()).toBe(403);
    expect(await crossSite.json()).toMatchObject({ error: "INVALID_ORIGIN" });
  }
  for (const path of ["/api/integrations/shopee/connect", "/api/integrations/shopee/disconnect", "/api/shops/demo/sync", "/api/variants/sample-1/costs", "/api/advertisement/import", "/api/advertisement/sync"]) {
    const response = await request.post(path, { headers: { Origin: "http://127.0.0.1:3100" }, form: { shopId: "123", amount: "100" }, maxRedirects: 0 });
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({ error: "DEMO_READ_ONLY" });
  }
  const auth = await request.get("/api/auth/ok");
  expect(auth.headers()["referrer-policy"]).toBe("no-referrer");
});

test("callback clears its binding and redirects to a clean app URL", async ({ request, page }) => {
  const callback = "/api/integrations/shopee/callback?code=fixture-sensitive-code&shop_id=123&auth_state=fixture-sensitive-state";
  const response = await request.get(callback, { maxRedirects: 0 });
  expect(response.status()).toBe(303);
  const location = response.headers().location;
  const target = new URL(location);
  expect(target.origin).toBe("http://127.0.0.1:3100");
  expect(target.pathname).toBe("/settings/integrations");
  expect(target.searchParams.get("connection")).toBe("failed");
  expect(target.searchParams.has("code")).toBe(false);
  expect(target.searchParams.has("auth_state")).toBe(false);
  expect(location).not.toContain("fixture-sensitive");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response.headers()["set-cookie"]).toMatch(/HttpOnly/i);
  expect(response.headers()["set-cookie"]).toMatch(/Max-Age=0/i);
  await page.goto(callback);
  await expect(page.getByRole("status")).toContainText("Connection could not be completed");
});
