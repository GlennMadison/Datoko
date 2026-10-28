import { test, expect } from "@playwright/test";

test("sales scope and status subrows work and reconcile", async ({ page }, testInfo) => {
  await page.goto("/overview?preset=last7&interval=day");
  const chart = page.getByRole("region", { name: "Sales chart", exact: true });
  const scope = chart.getByRole("combobox", { name: "Order scope" });
  await expect(scope).toHaveValue("paid");
  await expect(chart.getByRole("heading", { name: "Sales over time", exact: true })).toBeVisible();
  await chart.getByText("View chart data", { exact: true }).click();
  const sum = async () => chart.locator("tbody tr td:last-child").evaluateAll(cells => cells.reduce((total, cell) => total + Number(cell.textContent!.replace(/[^0-9-]/g, "")), 0));
  const paid = await sum();
  await scope.selectOption("completed");
  await expect(chart.getByRole("heading", { name: "Completed sales over time" })).toBeVisible();
  const completed = await sum();
  expect(paid).toBeGreaterThan(completed);
  await chart.getByRole("tab", { name: "Profit", exact: true }).click();
  await expect(chart.getByRole("heading", { name: "Clean profit over time" })).toBeVisible();
  await scope.selectOption("paid");
  await expect(chart.getByRole("heading", { name: "Estimated clean profit", exact: true })).toBeVisible();
  const status = page.getByRole("region", { name: "Order status", exact: true });
  for (const label of ["In progress", "Cancelled"]) {
    const parent = status.locator(".status-legend > div").filter({ hasText: label });
    const count = Number(await parent.locator("strong").innerText());
    const details = status.getByRole("list", { name: label + " breakdown", exact: true });
    const total = await details.locator("strong").evaluateAll(items => items.reduce((sum, item) => sum + Number(item.textContent), 0));
    expect(total).toBe(count);
  }
  await expect(status.getByText("Before payment", { exact: true })).toBeVisible();
  await expect(status.getByText("After payment", { exact: true })).toBeVisible();
  await expect(status.getByText("Returned", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("overview-restored.png"), fullPage: true });
});
