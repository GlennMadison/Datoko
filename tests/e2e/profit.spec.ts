import { test, expect } from "@playwright/test";

test("profit controls preserve missing data and work on desktop and mobile", async ({ page }) => {
  await page.goto("/overview");
  await expect(page.locator(".metrics-grid").getByText("Net profit", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh payouts", exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "Profit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Estimated clean profit", exact: true })).toBeVisible();
  await page.getByText("View chart data", { exact: true }).click();
  await expect(page.getByRole("table").first()).toContainText("Unavailable");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto("/orders");
  await expect(page.getByRole("button", { name: "Sort by net profit" })).toBeVisible();
  await page.getByRole("button", { name: "Sort by net profit" }).click();
  await expect(page.getByRole("region", { name: "Orders", exact: true })).toContainText("Payout pending");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
