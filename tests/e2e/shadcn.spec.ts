import { test, expect } from "@playwright/test";

test("order sorting and pagination keep the selected reporting period", async ({ page }) => {
  await page.goto("/orders?preset=last30");
  const range = await page.getByTestId("reporting-range").innerText();
  const orders = page.getByRole("region", { name: "Orders", exact: true });
  await page.getByLabel("Orders per page").selectOption("10");
  await expect(orders.locator("tbody tr")).toHaveCount(10);
  await page.getByRole("button", { name: "Next orders page" }).click();
  await expect(orders.locator("tbody tr")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Next orders page" })).toBeDisabled();
  await orders.getByRole("button", { name: "Sort by order value" }).click();
  await expect(orders.locator("tbody tr")).toHaveCount(10);
  const descending = await orders.locator("tbody tr td:last-child").allTextContents();
  const amounts = descending.map(value => Number(value.replace(/[^0-9]/g, "")));
  expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
  await expect(orders.getByRole("columnheader", { name: "Sort by order value" })).toHaveAttribute("aria-sort", "descending");
  await expect(page.getByTestId("reporting-range")).toHaveText(range);
  await expect(page).toHaveURL(/preset=last30/);
});

test("overview chart tabs render the selected measure and exact values", async ({ page }) => {
  await page.goto("/overview?preset=last7&interval=day");
  const expected = Number(await page.locator(".metric").filter({ hasText: "Orders placed" }).locator(".metric-value").innerText());
  await page.getByRole("tab", { name: "Orders", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Orders", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Orders over time", exact: true })).toBeVisible();
  await page.getByText("View chart data", { exact: true }).click();
  const values = await page.locator(".chart-data tbody tr td:last-child").allTextContents();
  expect(values.reduce((total, value) => total + Number(value.replaceAll(",", "")), 0)).toBe(expected);
  await page.getByRole("tab", { name: "Units", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Units sold over time", exact: true })).toBeVisible();
  await expect(page.getByLabel("Graph interval")).toHaveValue("day");
});

test("desktop sidebar collapse survives reload and restores with the keyboard shortcut", async ({ page, isMobile }) => {
  test.skip(isMobile, "Mobile uses a modal sheet.");
  await page.goto("/overview");
  const sidebar = page.locator('[data-slot="sidebar"][data-state]');
  const trigger = page.getByRole("button", { name: "Toggle sidebar", exact: true });
  await trigger.click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await page.reload();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await page.keyboard.press("Control+b");
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
