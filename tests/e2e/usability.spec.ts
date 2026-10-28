import { test, expect } from "@playwright/test";

test("mobile navigation supports Escape and closes after navigation", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The disclosure menu is specific to mobile widths.");
  await page.goto("/overview");
  const menu = page.getByRole("button", { name: "Toggle sidebar", exact: true });
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation).not.toBeVisible();
  await menu.click();
  await expect(navigation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
  await menu.click();
  await navigation.getByRole("link", { name: "Connections", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
});

test("an empty order search can be cleared without losing the reporting dates", async ({ page }) => {
  await page.goto("/orders?preset=last30");
  const range = await page.getByTestId("reporting-range").innerText();
  await page.getByLabel("Search orders", { exact: true }).fill("NO-MATCH-EXPECTED");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No matching orders" })).toBeVisible();
  await page.getByRole("link", { name: "Clear filters", exact: true }).click();
  await expect(page).toHaveURL(/preset=last30/);
  await expect(page.getByTestId("reporting-range")).toHaveText(range);
  await expect(page.getByRole("region", { name: "Orders", exact: true }).locator("tbody tr")).toHaveCount(12);
});

test("chart values are available without hovering or relying on color", async ({ page }) => {
  await page.goto("/overview?preset=last7&interval=day");
  await page.getByText("View chart data", { exact: true }).click();
  const data = page.locator(".chart-data");
  await expect(data.getByRole("table")).toBeVisible();
  await expect(data.getByRole("columnheader", { name: "Sales / IDR", exact: true })).toBeVisible();
  await expect(data.locator("tbody tr")).toHaveCount(7);
  await expect(data.locator("tbody tr").last().locator("td").last()).toContainText("Rp");
});
