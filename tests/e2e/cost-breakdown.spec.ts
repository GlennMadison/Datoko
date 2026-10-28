import { test, expect } from "@playwright/test";

test("overview pie shows clean profit and costs as shares of the same total", async ({ page }) => {
  await page.goto("/overview?preset=last7&interval=day");
  const card = page.getByRole("region", { name: "Cost breakdown", exact: true });
  await expect(card.getByRole("heading", { name: "Costs & clean profit", exact: true })).toBeVisible();
  await expect(card.getByRole("group", { name: "Costs and clean profit pie chart", exact: true })).toBeVisible();
  const list = card.getByLabel("Cost amounts and percentages").getByRole("list");
  for (const label of ["COGS", "Advertisement", "Affiliate commission", "Shopee commission", "Shopee service fee", "Shopee transaction fee", "Order processing fee", "Clean profit"]) {
    const item = list.getByRole("listitem").filter({ has: page.getByText(label, { exact: true }) });
    await expect(item).toContainText("Rp");
    await expect(item.locator("small")).toHaveText(/^-?\d+(?:\.\d+)?%$/);
  }
  await expect(card.getByText("Data notes", { exact: true })).toHaveCount(0);
  const profitRow = list.getByRole("listitem").filter({ has: page.getByText("Clean profit", { exact: true }) });
  const summary = page.locator(".metrics-grid");
  await expect(profitRow.locator("strong")).toHaveText(await summary.locator(".metric").filter({ hasText: "Net profit" }).locator(".metric-value").innerText());
  await expect(summary.getByText("Ad spend", { exact: true })).toBeVisible();
  await expect(summary.getByText("Confirmed refunds", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("cost chart respects an empty historical reporting period", async ({ page }) => {
  await page.goto("/overview?preset=custom&from=2020-01-01&to=2020-01-03&interval=day");
  const card = page.getByRole("region", { name: "Cost breakdown", exact: true });
  await expect(card.getByRole("heading", { name: "No recorded costs" })).toBeVisible();
  await expect(card.getByRole("list", { name: "Amounts and percentages" })).toHaveCount(0);
  await expect(card).not.toContainText("NaN");
});
