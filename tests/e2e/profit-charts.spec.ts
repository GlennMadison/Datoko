import { test, expect } from "@playwright/test";

test("profit cards are compact, responsive and show tooltips over center labels", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/overview?preset=last7&interval=day");
  const cost = page.getByRole("region", { name: "Cost breakdown", exact: true });
  const products = page.getByRole("region", { name: "Product clean profit", exact: true });
  await expect(cost.getByRole("heading", { name: "Costs & clean profit" })).toBeVisible();
  await expect(products.getByRole("heading", { name: "Clean profit by product" })).toBeVisible();
  await expect(products.locator(".profit-ledger li")).not.toHaveCount(0);
  await expect(products.locator(".profit-donut-center strong")).toHaveText(await cost.locator(".profit-donut-center strong").innerText());
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (page.viewportSize()!.width >= 1280) {
    const a = (await cost.boundingBox())!, b = (await products.boundingBox())!;
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    expect(b.x).toBeGreaterThan(a.x + a.width);
    expect(a.height).toBeLessThan(330);
  }
  for (const card of [cost, products]) {
    await card.scrollIntoViewIfNeeded();
    const chart = card.locator(".profit-donut-chart");
    await expect(chart.locator(".recharts-sector").first()).toBeVisible();
    // Pick an actual painted point on the ring rather than the empty donut hole.
    const point = await chart.locator(".recharts-sector").first().evaluate(element => {
      const path = element as SVGPathElement;
      const rect = path.getBoundingClientRect();
      for (let y = rect.top + 2; y < rect.bottom; y += 3) for (let x = rect.left + 2; x < rect.right; x += 3) {
        const p = new DOMPoint(x, y).matrixTransform(path.getScreenCTM()!.inverse());
        if (path.isPointInFill(p)) return { x, y };
      }
      throw new Error("No painted sector point");
    });
    await page.mouse.move(point.x, point.y);
    const tooltip = card.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    // Move the visible tooltip over the number to reproduce the original overlap.
    const overlap = await card.evaluate(card => {
      const tip = card.querySelector<HTMLElement>(".recharts-tooltip-wrapper")!;
      const center = card.querySelector<HTMLElement>(".profit-donut-center")!;
      const origin = tip.offsetParent!.getBoundingClientRect();
      const label = center.getBoundingClientRect();
      center.style.pointerEvents = "auto";
      tip.style.pointerEvents = "auto";
      tip.style.transform = "none";
      tip.style.left = (label.left - origin.left) + "px";
      tip.style.top = (label.top + label.height / 2 - origin.top - 15) + "px";
      const box = card.querySelector<HTMLElement>('[role="tooltip"]')!.getBoundingClientRect();
      const stack = document.elementsFromPoint(box.left + 10, box.top + 10);
      const tooltipIndex = stack.findIndex(el => el.closest('[role="tooltip"]'));
      const centerIndex = stack.findIndex(el => el.closest(".profit-donut-center"));
      return tooltipIndex >= 0 && centerIndex > tooltipIndex;
    });
    expect(overlap).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(card === cost ? "cost-tooltip.png" : "product-tooltip.png") });
    await page.mouse.move(0, 0);
  }
  await page.screenshot({ path: testInfo.outputPath("profit-cards.png"), fullPage: true });
  expect(errors).toEqual([]);
});
