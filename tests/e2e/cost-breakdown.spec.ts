import { test, expect } from "@playwright/test";

test("overview cost pie exposes amounts and both percentage bases without requiring hover", async ({ page }) => {
  await page.goto("/overview?preset=last7&interval=day");
  const card = page.getByRole("region", { name: "Cost breakdown", exact: true });
  await expect(card.getByRole("heading", { name: "Cost breakdown", exact: true })).toBeVisible();
  await expect(card.getByRole("img", { name: /Cost breakdown pie chart/ })).toBeVisible();
  const list = card.getByRole("list", { name: "Cost amounts and percentages" });
  for (const label of ["COGS", "Advertisement", "Affiliate commission", "Shopee commission", "Shopee service fee", "Shopee transaction fee", "Order processing fee"]) {
    const item = list.getByRole("listitem").filter({ has: page.getByText(label, { exact: true }) });
    await expect(item).toContainText("Rp");
    await expect(item).toContainText("% of costs");
    await expect(item).toContainText("% of sales");
  }
  const summary = page.locator(".metrics-grid");
  await expect(summary.getByText("Ad spend", { exact: true })).toBeVisible();
  await expect(summary.getByText("Confirmed refunds", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("cost chart respects an empty historical reporting period", async ({ page }) => {
  await page.goto("/overview?preset=custom&from=2020-01-01&to=2020-01-03&interval=day");
  const card = page.getByRole("region", { name: "Cost breakdown", exact: true });
  await expect(card.getByRole("heading", { name: "No recorded costs" })).toBeVisible();
  await expect(card.getByRole("list", { name: "Cost amounts and percentages" })).toHaveCount(0);
  await expect(card).not.toContainText("NaN");
});
