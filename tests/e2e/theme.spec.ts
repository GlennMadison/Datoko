import { test, expect, type Page } from "@playwright/test";

const storageKey = "datoko.theme.v1";
const background = (page: Page) => page.locator("body");
// Palette from the approved Dashboard UI Revision on Main.
const light = "rgb(248, 249, 248)";
const dark = "rgb(20, 20, 21)";

// Check the rendered palette, not just the preference attribute.
test("System is the default and follows OS changes while the page stays open", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/overview");
  await expect(page.getByLabel("Theme", { exact: true })).toHaveValue("system");
  await expect(background(page)).toHaveCSS("background-color", dark);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(background(page)).toHaveCSS("background-color", light);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(background(page)).toHaveCSS("background-color", dark);
});

test("explicit choices override the OS, survive reloads and navigation, and can return to System", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && /hydrat/i.test(message.text())) errors.push(message.text()); });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/overview");
  await page.getByLabel("Theme", { exact: true }).selectOption("light");
  await expect(background(page)).toHaveCSS("background-color", light);
  await page.reload();
  await expect(page.getByLabel("Theme", { exact: true })).toHaveValue("light");
  await expect(background(page)).toHaveCSS("background-color", light);
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(background(page)).toHaveCSS("background-color", dark);
  await page.getByRole("link", { name: "Connection settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
  await expect(page.getByLabel("Theme", { exact: true })).toHaveValue("dark");
  await expect(background(page)).toHaveCSS("background-color", dark);
  await page.getByLabel("Theme", { exact: true }).selectOption("system");
  await expect(background(page)).toHaveCSS("background-color", light);
  expect(errors).toEqual([]);
});

test("preferences sync between open tabs, including clearing the saved preference", async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/overview");
  const other = await context.newPage();
  await other.emulateMedia({ colorScheme: "light" });
  await other.goto("/login");
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await expect(other.getByLabel("Theme", { exact: true })).toHaveValue("dark");
  await expect(background(other)).toHaveCSS("background-color", dark);
  await other.evaluate(() => localStorage.clear());
  await expect(page.getByLabel("Theme", { exact: true })).toHaveValue("system");
  await expect(background(page)).toHaveCSS("background-color", light);
});

test("saved dark mode is applied before React loads", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(key => localStorage.setItem(key, "dark"), storageKey);
  await page.route("**/_next/static/**/*.js", route => route.abort());
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(background(page)).toHaveCSS("background-color", dark);
});

test("blocked storage falls back to System and still allows manual switching", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, "getItem", { value() { throw new DOMException("Blocked", "SecurityError"); } });
    Object.defineProperty(Storage.prototype, "setItem", { value() { throw new DOMException("Blocked", "SecurityError"); } });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");
  await expect(page.getByLabel("Theme", { exact: true })).toHaveValue("system");
  await expect(background(page)).toHaveCSS("background-color", dark);
  await page.getByLabel("Theme", { exact: true }).selectOption("light");
  await expect(background(page)).toHaveCSS("background-color", light);
});

test("dark mode covers dashboard, date picker, charts, and account pages without horizontal overflow", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/overview?preset=last7");
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await page.getByRole("button", { name: /^Date range:/ }).click();
  const picker = page.getByRole("dialog", { name: "Choose reporting dates" });
  await expect(picker).toBeVisible();
  await expect(picker).toHaveCSS("background-color", "rgb(27, 27, 29)");
  await page.screenshot({ path: testInfo.outputPath("dark-date-picker.png"), fullPage: true });
  await page.keyboard.press("Escape");
  const plot = page.locator(".report-chart");
  await expect(plot.locator(".recharts-cartesian-axis-tick-value").first()).toHaveCSS("fill", "rgb(163, 165, 164)");
  await expect(plot.locator(".recharts-area-curve")).toHaveCSS("stroke", "rgb(139, 206, 172)");
  await page.screenshot({ path: testInfo.outputPath("dark-overview.png"), fullPage: true });
  for (const route of ["/orders", "/products", "/returns", "/advertisement", "/settings/integrations", "/settings/sync", "/login", "/signup", "/setup"]) {
    await page.goto(route);
    await expect(page.getByLabel("Theme", { exact: true })).toHaveValue("dark");
    await expect(background(page)).toHaveCSS("background-color", dark);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), route).toBe(true);
  }
  expect(errors).toEqual([]);
});
