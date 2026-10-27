import { test, expect } from "@playwright/test";
test("courier automation is readable, responsive and read-only in demo", async ({ page }, testInfo) => {
  const errors: string[]=[]; page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/settings/automation");
  await expect(page.getByRole("heading",{name:"Order automation",exact:true})).toBeVisible();
  await expect(page.getByRole("switch",{name:"Auto process orders",exact:true})).toBeDisabled();
  await expect(page.getByRole("switch",{name:"Auto process Anteraja Reguler",exact:true})).toBeDisabled();
  await expect(page.getByRole("switch",{name:"Auto process Anteraja Same Day",exact:true})).toBeDisabled();
  await expect(page.getByLabel("Shipment method").first()).toBeVisible();
  await expect(page.getByRole("button",{name:"Refresh couriers",exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath("automation.png"),fullPage:true});
  const crossSite=await page.request.post("/api/shops/example/auto-process",{headers:{Origin:"https://other.example"},data:{enabled:true}});
  expect(crossSite.status()).toBe(403);
  const demoWrite=await page.request.post("/api/shops/example/auto-process",{headers:{Origin:"http://127.0.0.1:3100"},data:{enabled:true}});
  expect(demoWrite.status()).toBe(409);
  expect(errors).toEqual([]);
});
