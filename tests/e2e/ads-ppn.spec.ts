import { test, expect } from "@playwright/test";

test("Overview and ads show the same PPN-inclusive expense without overflowing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/overview?preset=last7&interval=day");
  const spend = page.locator(".metrics-grid .metric").filter({ has: page.getByText("Ad spend", { exact: true }) });
  await expect(spend).toContainText("PPN 11%");
  const total = await spend.locator(".metric-value").innerText();
  await expect(page.getByRole("region", { name: "Cost breakdown", exact: true })).toContainText("Ad PPN (11%)");
  await expect(page.getByRole("region", { name: "Product clean profit", exact: true })).toContainText("After ads & PPN");
  await page.goto("/advertisement?preset=last7&interval=day");
  await expect(page.getByTestId("ad-spend")).toHaveText(total);
  await expect(page.getByTestId("ad-spend").locator("..")).toContainText("PPN 11%");
  await expect(page.getByRole("columnheader", { name: "PPN (11%)", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Total Ad Cost", exact: true })).toBeVisible();
  await expect(page.getByTestId("original-roas").locator("..")).toContainText("before PPN");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
