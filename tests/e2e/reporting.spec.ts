import { test, expect, type Page } from "@playwright/test";

async function openDates(page: Page) {
  const picker = page.getByRole("dialog", { name: "Choose reporting dates" });
  if (!await picker.isVisible()) await page.getByRole("button", { name: /^Date range:/ }).click();
  await expect(picker).toBeVisible();
  return picker;
}
async function chooseQuick(page: Page, label: string) {
  await (await openDates(page)).getByRole("button", { name: label, exact: true }).click();
}

test("date presets, months, weeks and intervals reload automatically and survive navigation", async ({ page }, testInfo) => {
  await page.goto("/overview");
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
  await chooseQuick(page, "Today");
  await expect(page).toHaveURL(/preset=today/);
  await page.getByLabel("Graph interval").selectOption("3hour");
  await expect(page).toHaveURL(/interval=3hour/);
  await page.getByRole("link", { name: "Advertisement", exact: true }).click();
  await expect(page).toHaveURL(/advertisement\?.*preset=today.*interval=3hour/);
  await expect(page.getByLabel("Graph interval")).toHaveValue("3hour");
  await expect(page.getByTestId("original-roas")).not.toHaveText("Unavailable");
  await page.getByLabel("Graph interval").selectOption("day");
  await (await openDates(page)).getByRole("button", { name: "By month", exact: true }).click();
  await page.getByLabel("Reporting year").selectOption("2024");
  await page.screenshot({ path: testInfo.outputPath("month-picker.png"), fullPage: true });
  await page.getByRole("button", { name: "February 2024", exact: true }).click();
  await expect(page).toHaveURL(/month=2/);
  await (await openDates(page)).getByRole("button", { name: "By week", exact: true }).click();
  await page.getByRole("button", { name: /^Week 4/ }).click();
  await expect(page).toHaveURL(/week=4/);
  await expect(page.getByTestId("reporting-range")).toContainText("22 Feb 2024");
  await expect(page.getByTestId("reporting-range")).toContainText("29 Feb 2024");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("calendar-filters.png"), fullPage: true });
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page).toHaveURL(/orders\?.*week=4/);
  await expect(page.getByTestId("reporting-range")).toContainText("22 Feb 2024");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Advertisement.", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("reporting-range")).toContainText("1 Feb 2024");
});

test("valid custom dates debounce automatically and invalid ranges retain the current report", async ({ page }) => {
  await page.goto("/orders?preset=month&year=2024&month=2&interval=day");
  await (await openDates(page)).getByRole("button", { name: "Custom range", exact: true }).click();
  await page.getByLabel("From date").fill("2024-02-03");
  await page.getByLabel("To date").fill("2024-02-07");
  await expect(page).toHaveURL(/preset=custom/);
  await expect(page.getByTestId("reporting-range")).toContainText("3 Feb 2024");
  await expect(page.getByTestId("reporting-range")).toContainText("7 Feb 2024");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const validUrl = page.url();
  await page.getByLabel("From date").fill("2024-02-10");
  await expect(page.getByRole("region", { name: "Reporting period" }).getByRole("alert")).toContainText("valid range");
  expect(page.url()).toBe(validUrl);
  await chooseQuick(page, "Today");
  await expect(page).toHaveURL(/preset=today/);
  await expect(page.getByRole("region", { name: "Reporting period" }).getByRole("alert")).toHaveCount(0);
});

test("quick successive choices settle on the newest range and interval", async ({ page }) => {
  await page.goto("/overview");
  await chooseQuick(page, "Today");
  await chooseQuick(page, "Last 7 days");
  await page.getByLabel("Graph interval").selectOption("week");
  await expect(page).toHaveURL(/preset=last7.*interval=week/);
  await expect(page.getByRole("button", { name: "Date range: Last 7 days", exact: true })).toBeVisible();
  await expect(page.getByLabel("Graph interval")).toHaveValue("week");
});

test("calendar selection, yearly reports, and keyboard dismissal work", async ({ page }) => {
  await page.goto("/overview?preset=month&year=2024&month=2&interval=auto");
  await openDates(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Choose reporting dates" })).not.toBeVisible();
  await expect(page.getByRole("button", { name: /^Date range:/ })).toBeFocused();
  await page.keyboard.press("Enter");
  const picker = page.getByRole("dialog", { name: "Choose reporting dates" });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "By day", exact: true }).click();
  await picker.getByRole("button", { name: "2024-02-29", exact: true }).click();
  await expect(page).toHaveURL(/from=2024-02-29&to=2024-02-29/);
  await expect(page.getByTestId("reporting-range")).toContainText("29 Feb 2024");
  await (await openDates(page)).getByRole("button", { name: "By year", exact: true }).click();
  await picker.getByRole("button", { name: "2024", exact: true }).click();
  await expect(page).toHaveURL(/from=2024-01-01&to=2024-12-31/);
  await expect(page.getByRole("button", { name: "Date range: 2024", exact: true })).toBeVisible();
  await openDates(page);
  await page.mouse.click(2, 2);
  await expect(picker).not.toBeVisible();
});

test("sample ads reconcile to item adjustments and expose a read-only import", async ({ page, request }, testInfo) => {
  const response = await request.get("/api/advertisement/report?preset=last7&interval=day");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const result = (await response.json()).summary;
  expect(Number(result.originalRevenue) - Number(result.retainedRevenue)).toBe(150000);
  expect(Number(result.originalRoas)).toBeGreaterThan(Number(result.realRoas));
  const hourly = (await (await request.get("/api/advertisement/report?preset=last7&interval=hour")).json()).summary;
  expect([hourly.spend, hourly.originalRevenue, hourly.retainedRevenue]).toEqual([result.spend, result.originalRevenue, result.retainedRevenue]);
  await page.goto("/advertisement?preset=last7&interval=day");
  await expect(page.getByTestId("real-roas")).toHaveText(`${result.realRoas}x`);
  await expect(page.getByRole("button", { name: "Import report", exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("advertisement.png"), fullPage: true });
  const crossSite = await request.post("/api/advertisement/import", { headers: { Origin: "https://outsider.example.test" }, data: {} });
  expect(crossSite.status()).toBe(403);
  for (const query of ["preset=tomorrow", "preset=today&preset=last30", "tz=UTC"]) {
    expect((await request.get(`/api/advertisement/report?${query}`)).status()).toBe(400);
  }
});
