import { test, expect } from "@playwright/test";

test("products collapse variations and preserve individual cost controls", async ({ page }) => {
  await page.goto("/products");
  const table = page.getByRole("table", { name: "Product costs", exact: true });
  await expect(table.locator(":scope > tbody > tr")).toHaveCount(4);
  const toggle = page.getByRole("button", { name: "Show variations for Desktop speaker stand", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("table", { name: "Variations for Desktop speaker stand", exact: true })).toHaveCount(0);
  await toggle.focus();
  await page.keyboard.press("Enter");
  const variations = page.getByRole("table", { name: "Variations for Desktop speaker stand", exact: true });
  await expect(variations).toBeVisible();
  await expect(variations.locator("tbody tr")).toHaveCount(2);
  await expect(variations.getByText("Black", { exact: true })).toBeVisible();
  await expect(variations.getByText("White", { exact: true })).toBeVisible();
  await expect(variations.getByText("SKU: SPK-BLK", { exact: true })).toBeVisible();
  await expect(variations.getByText("SKU: SPK-WHT", { exact: true })).toBeVisible();
  await expect(variations.locator('form[action="/api/variants/sample-1/costs"]')).toHaveCount(1);
  await expect(variations.locator('form[action="/api/variants/sample-5/costs"]')).toHaveCount(1);
  for (const button of await variations.getByRole("button", { name: "Save cost", exact: true }).all()) await expect(button).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Hide variations", exact: true }).click();
  await expect(variations).toHaveCount(0);
  await page.goto("/overview");
  await expect(page.locator(".rank-detail strong").filter({ hasText: "Desktop speaker stand" })).toHaveCount(1);
});
