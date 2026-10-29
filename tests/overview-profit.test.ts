import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateOrderProfit, normalizeSettlement } from "../src/core/profit.ts";
import { profitAfterAdSpend } from "../src/core/overview-profit.ts";

test("overview deducts advertising after payout and COGS without repeating Shopee deductions", () => {
  const settlement = normalizeSettlement({ order_sn: "order1", order_income: {
    escrow_amount: "100000", escrow_amount_after_adjustment: "70000",
    seller_return_refund: "-32750", commission_fee: "10000", order_ams_commission_fee: "5000",
  } }, "order1");
  const result = calculateOrderProfit({ status: "COMPLETED", items: [{ quantity: 2, costSnapshot: "10000" }] }, settlement);
  assert.equal(profitAfterAdSpend(result.profit, "15000"), 33350);
  assert.equal(result.profit, "50000.0000");
});

test("advertising can produce losses, including periods with no completed sales", () => {
  assert.equal(profitAfterAdSpend(10000, 25000), -17750);
  assert.equal(profitAfterAdSpend(0, 25000), -27750);
  assert.equal(profitAfterAdSpend(-5000, 25000), -32750);
  assert.equal(profitAfterAdSpend(10000, 0), 10000);
  assert.equal(profitAfterAdSpend(0, 0), 0);
});

test("missing payouts, costs or ad coverage remain unknown rather than zero", () => {
  const order = { status: "COMPLETED", items: [{ quantity: 1, costSnapshot: null }] };
  assert.equal(profitAfterAdSpend(calculateOrderProfit(order, null).profit, 5000), null);
  assert.equal(profitAfterAdSpend(10000, null), null);
  assert.equal(profitAfterAdSpend(null, null), null);
});

test("fractional amounts subtract exactly before display rounding", () => {
  assert.equal(profitAfterAdSpend("49506.3234", "10000.1234"), 38406.1864);
  assert.equal(profitAfterAdSpend("0.3", "0.2"), 0.078);
});
