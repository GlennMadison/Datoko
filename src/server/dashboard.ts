import { isOverviewOrder, netOrderSales } from "../core/overview-sales.ts";
import { summarizeProductProfit, type ProductProfitBase } from "../core/product-profit.ts";
import { summarizeOrderCosts, type CostSummary } from "../core/cost-breakdown.ts";
import { cancellationBreakdown } from "../core/cancellations.ts";
import { calculateOrderProfit, normalizeSettlement, readSettlement, type OrderProfit } from "../core/profit.ts";
import { amountString, amountUnits } from "../core/money.ts";
import { groupProducts, type ProductGroup, type ProductVariantRow } from "../core/products.ts";
import { getDb } from "./db.ts";
import { getConfig, isDemo, loginMissing } from "./env.ts";
import { requireUser } from "./auth.ts";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "../core/errors.ts";
import { dayStart, periodContains, resolveReportPeriod, shiftDate, type ReportPeriod } from "../core/reporting-period.ts";
import { activityTrend, type ActivityPoint } from "./reporting.ts";
import { cache } from "react";
import { orderStatusSummary } from "../core/order-status.ts";
import { reportShop, cachedReport, type ReportShop } from "./report-context.ts";
import { reportOrders, reportProducts, reportReturns } from "./report-queries.ts";

export type OrderRow = { id: string; orderSn: string; name: string; variationName?: string | null; sku: string; quantity: number; total: number; merchandise: string; status: string; paymentStatus?: string; createdAt: string; hasReturn: boolean; costMissing: boolean; profit?: number | null; profitQuality?: OrderProfit["quality"]; payout?: number | null; cogs?: number | null };
export type ProductRow = ProductVariantRow;
export type ReturnRow = { id: string; returnSn: string; orderSn: string; status: string; reportedAmount: number | null; confirmedRefund: number | null; updatedAt: string };
export type RunRow = { id: string; status: string; reason: string; processed: number; errorCode: string | null; createdAt: string };
export type DashboardData = {
  mode: "demo" | "live";
  shop: { id: string; name: string; sourceShopId: string; status: string; environment: string } | null;
  metrics: { sales: number; placedValue: number; orders: number; completed: number; cancelled: number; profit: number | null; refunds: number | null };
  trend: ActivityPoint[];
  orders: OrderRow[];
  products: ProductGroup[];
  returns: ReturnRow[];
  runs: RunRow[];
  lastSyncedAt: string | null;
  coverageFrom: string | null;
  ordersCheckpoint: string | null;
  financeReady: boolean;
  costSummary?: CostSummary;
  productProfit?: ProductProfitBase;
  returnsReady?: boolean;
  returnsError?: string | null;
  cancellations?: ReturnType<typeof cancellationBreakdown>;
  orderStatus?: ReturnType<typeof orderStatusSummary>;
  profitSummary?: { covered: number; eligible: number; estimated: number; payout: number; cogs: number; lastSyncedAt: string | null; error: string | null };
};

export function demoDashboard(period: ReportPeriod): DashboardData {
  const sampleProducts = [
    { id: "sample-1", name: "Desktop speaker stand", sku: "SPK-BLK", cost: 46000, units: 34 },
    { id: "sample-2", name: "Universal soundbar stand", sku: "SND-BLK", cost: 38000, units: 22 },
    { id: "sample-3", name: "Ambient table lamp", sku: "LMP-IVY", cost: 72000, units: 16 },
    { id: "sample-4", name: "Compact speaker stand", sku: "CMP-WHT", cost: null, units: 11 },
  ];
  const products: ProductRow[] = sampleProducts.map((product, index) => ({ ...product, variationName: index === 0 ? "Black" : null, shopId: "demo", sourceItemId: String(1000 + index), sourceModelId: "0", nameObservedAt: "2026-01-01T00:00:00.000Z" }));
  products.push({ ...products[0], id: "sample-5", sourceModelId: "1", variationName: "White", sku: "SPK-WHT", cost: 48000, units: 0, nameObservedAt: "2026-01-02T00:00:00.000Z" });
  const todayStart = dayStart(period.today).getTime();
  const currentHour = Math.max(0, Math.floor((Date.now() - todayStart) / 3_600_000));
  const allOrders: OrderRow[] = Array.from({ length: 12 }, (_, index) => {
    const product = products[index % sampleProducts.length];
    const total = [110000, 98000, 175000, 89000][index % 4];
    const createdAt = new Date(dayStart(shiftDate(period.today, -Math.floor(index / 2))).getTime() + Math.min(currentHour, index % 2 ? 15 : 9) * 3_600_000).toISOString();
    return { id: `sample-${index}`, orderSn: `DEMO-${index + 1024}`, name: product.name, variationName: product.variationName, sku: product.sku, quantity: index % 5 === 0 ? 2 : 1, total, merchandise: String(total), status: index === 4 ? "CANCELLED" : index < 2 ? "READY_TO_SHIP" : "COMPLETED", createdAt, hasReturn: index === 3, costMissing: product.cost === null };
  });
  const orders = allOrders.filter(order => periodContains(period, order.createdAt));
  const returns = [{ id: "sample-return", returnSn: "RETURN-DEMO-001", orderSn: allOrders[3].orderSn, status: "RESOLVED", reportedAmount: 40000, confirmedRefund: 40000, updatedAt: new Date(Math.min(Date.now() - 1000, todayStart + 8 * 3_600_000)).toISOString() }].filter(value => periodContains(period, value.updatedAt));
  for (const product of products) product.units = orders.filter(order => order.sku === product.sku && order.status === "COMPLETED").reduce((sum, order) => sum + order.quantity, 0);
  const completed = orders.filter(order => order.status === "COMPLETED");
  const demoProfits = new Map<string, string | null>();
  const productProfitOrders: Parameters<typeof summarizeProductProfit>[0] = [];
  const costSummary = summarizeOrderCosts(completed.map(order => {
    const share = (percent: number) => amountString(amountUnits(order.merchandise) * BigInt(percent) / 100n);
    const refund = order.hasReturn ? 40000n * 10000n : 0n;
    const settlement = normalizeSettlement({ order_sn: order.orderSn, order_income: {
      escrow_amount: amountString(amountUnits(order.merchandise) * 85n / 100n - 1250n * 10000n - refund),
      commission_fee: share(6), service_fee: share(4), seller_transaction_fee: share(2),
      order_ams_commission_fee: share(3), seller_order_processing_fee: "1250", seller_return_refund: amountString(-refund),
    } }, order.orderSn);
    const product = products.find(product => product.sku === order.sku)!;
    const profit = calculateOrderProfit({ status: order.status, items: [{ quantity: order.quantity, costSnapshot: product.cost === null ? null : String(product.cost) }] }, settlement);
    demoProfits.set(order.id, profit.profit);
    productProfitOrders.push({ status: order.status, payout: profit.payout, items: [{ itemId: product.sourceItemId, quantity: order.quantity, paidUnitPrice: amountString(amountUnits(order.merchandise) / BigInt(order.quantity)), costSnapshot: product.cost === null ? null : String(product.cost) }] });
    return { status: order.status, merchandise: order.merchandise, profit, settlement };
  }));
  const salesOrders = orders.map(order => ({ ...order, profit: demoProfits.get(order.id) ?? null,
    returns: order.hasReturn ? [{ id: "sample-return", status: "ACCEPTED", confirmedRefund: "40000" }] : [],
  }));
  const cancellations = cancellationBreakdown(orders.map(order => ({ ...order, paymentStatus: "UNPAID", returns: [] })));
  return {
    mode: "demo", shop: { id: "demo", name: "Sample workspace", sourceShopId: "-", status: "NOT_CONNECTED", environment: "sandbox" },
    metrics: { sales: Number(amountString(salesOrders.reduce((sum, order) => sum + amountUnits(netOrderSales(order)), 0n))), placedValue: orders.reduce((sum, order) => sum + order.total, 0), orders: orders.length, completed: completed.length, cancelled: orders.filter(order => order.status === "CANCELLED").length, profit: costSummary.profit === null ? null : Number(costSummary.profit), refunds: returns.reduce((sum, value) => sum + value.confirmedRefund, 0) },
    trend: activityTrend(period, salesOrders, returns.map(value => ({ ...value, confirmedRefund: String(value.confirmedRefund) }))),
    orders, cancellations, products: groupProducts(products), costSummary, productProfit: summarizeProductProfit(productProfitOrders),
    returns,
    runs: [], lastSyncedAt: null, coverageFrom: null, ordersCheckpoint: null, financeReady: false,
  };
}

export const requireDashboardUser = cache(async () => {
  if (loginMissing().length) redirect("/setup");
  return requireUser(await headers()).catch(error => {
    if (error instanceof AppError && ["SIGN_IN_REQUIRED", "AUTH_METHOD_REQUIRED"].includes(error.code)) redirect("/login");
    throw error;
  });
});

export async function getDashboardData(selection: ReportPeriod | number = 30): Promise<DashboardData> {
  const period = typeof selection === "number" ? resolveReportPeriod({ days: String(selection) }) : selection;
  if (isDemo()) return demoDashboard(period);
  const actor = await requireDashboardUser();
  const config = getConfig();
  const shop = await reportShop(actor.ownerId, config.SHOPEE_ENV);
  if (!shop) return { mode: "live", shop: null, metrics: { sales: 0, placedValue: 0, orders: 0, completed: 0, cancelled: 0, profit: null, refunds: null }, orders: [], products: [], returns: [], runs: [], trend: [], lastSyncedAt: null, coverageFrom: null, ordersCheckpoint: null, financeReady: false };
  return cachedReport(shop, "overview", period, null, async () => {
    const data = await dashboardForShop(shop, period);
    return { ...data, orderStatus: orderStatusSummary(data.orders), orders: data.orders.slice(0, 10), returns: [], runs: [] };
  });
}

export async function dashboardForShop(shop: ReportShop, period: ReportPeriod): Promise<DashboardData> {
  const db = getDb();
  const range = { gte: new Date(period.fromISO), lt: new Date(period.effectiveToISO) };
  const [orderCount, returnCount] = await Promise.all([
    db.order.count({ where: { shopId: shop.id, sourceCreatedAt: range } }),
    db.returnCase.count({ where: { shopId: shop.id, sourceUpdatedAt: range } }),
  ]);
  if (orderCount > 50_000 || returnCount > 50_000) throw new AppError("REPORT_RANGE_TOO_LARGE", 400);
  const [orders, variants, returns] = await Promise.all([
    reportOrders(db, shop.id, period.fromISO, period.effectiveToISO),
    reportProducts(shop.id),
    reportReturns(db, shop.id, period.fromISO, period.effectiveToISO),
  ]);
  const returnState = shop.syncStates.find(state => state.resource === "returns");
  const returnsReady = Boolean(returnState?.lastSuccessAt && !returnState.lastErrorCode);
  const cancellations = cancellationBreakdown(orders);
  const profits = new Map(orders.map(order => [order.id, calculateOrderProfit({ status: order.status, items: order.items.map(item => ({ quantity: item.quantity, costSnapshot: item.costSnapshot?.toString() ?? null, costQuality: item.costQuality })) }, readSettlement(order.financialSnapshots[0]?.amounts))]));
  const sourceItems = new Map(variants.map(variant => [variant.id, variant.sourceItemId]));
  const productProfit = summarizeProductProfit(orders.map(order => ({ status: order.status, payout: profits.get(order.id)!.payout, items: order.items.map(item => ({ itemId: sourceItems.get(item.variantId)!, quantity: item.quantity, paidUnitPrice: item.paidUnitPrice.toString(), costSnapshot: item.costSnapshot?.toString() ?? null })) })));
  const eligible = orders.filter(order => order.status === "COMPLETED");
  const covered = eligible.map(order => profits.get(order.id)!).filter(result => result.profit !== null);
  const sum = (key: "profit" | "payout" | "cogs") => Number(amountString(covered.reduce((total, result) => total + amountUnits(result[key]!), 0n)));
  const costSummary = summarizeOrderCosts(orders.map(order => ({
    status: order.status, merchandise: order.merchandiseAmount.toString(),
    profit: profits.get(order.id)!, settlement: readSettlement(order.financialSnapshots[0]?.amounts),
  })));
  const financeState = shop.syncStates.find(state => state.resource === "finance");
  const profitSummary = { covered: covered.length, eligible: eligible.length, estimated: covered.filter(result => result.quality === "ESTIMATED").length, payout: sum("payout"), cogs: sum("cogs"), lastSyncedAt: financeState?.lastSuccessAt?.toISOString() ?? null, error: financeState?.lastErrorCode ?? null };
  const salesOrders = orders.map(order => ({
    createdAt: order.sourceCreatedAt.toISOString(), status: order.status, paymentStatus: order.paymentStatus,
    merchandise: order.merchandiseAmount.toString(), quantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
    profit: profits.get(order.id)?.profit ?? null,
    settlementRefund: readSettlement(order.financialSnapshots[0]?.amounts)?.refunds ?? null,
    returns: order.returns.map(value => ({ ...value, confirmedRefund: value.confirmedRefund?.toString() ?? null })),
  }));
  const overviewOrders = orders.filter(isOverviewOrder);
  const trend = activityTrend(period, salesOrders, returns.map(value => ({ updatedAt: value.sourceUpdatedAt.toISOString(), confirmedRefund: value.confirmedRefund?.toString() ?? null })));
  const unitsByVariant = new Map<string, number>();
  for (const order of orders) {
    if (order.status !== "COMPLETED") continue;
    for (const item of order.items) unitsByVariant.set(item.variantId, (unitsByVariant.get(item.variantId) ?? 0) + item.quantity);
  }
  const state = shop.syncStates.find(state => state.resource === "orders");
  return {
    mode: "live", shop: { id: shop.id, name: shop.name, sourceShopId: shop.sourceShopId, status: shop.connection?.status ?? "DISCONNECTED", environment: shop.environment },
    metrics: { orders: overviewOrders.length, completed: overviewOrders.filter(order => order.status === "COMPLETED").length, cancelled: orders.filter(order => order.status === "CANCELLED").length, sales: Number(amountString(salesOrders.reduce((sum, order) => sum + amountUnits(netOrderSales(order)), 0n))), placedValue: orders.reduce((sum, order) => sum + Number(order.totalAmount), 0), profit: covered.length ? sum("profit") : eligible.length ? null : 0, refunds: returnsReady ? returns.reduce((sum, value) => sum + Number(value.confirmedRefund ?? 0), 0) : null },
    costSummary, productProfit, profitSummary, returnsReady, returnsError: returnState?.lastErrorCode ?? null, cancellations,
    trend,
    orders: orders.map(order => ({ id: order.id, orderSn: order.orderSn, name: order.items[0]?.name ?? "Order", variationName: order.items[0]?.variationName ?? null, sku: order.items[0]?.sku ?? "-", quantity: order.items.reduce((sum, item) => sum + item.quantity, 0), total: Number(order.totalAmount), merchandise: order.merchandiseAmount.toString(), status: order.status, paymentStatus: order.paymentStatus, createdAt: order.sourceCreatedAt.toISOString(), hasReturn: order.returns.length > 0, costMissing: order.items.some(item => item.costSnapshot === null), profit: profits.get(order.id)!.profit === null ? null : Number(profits.get(order.id)!.profit), profitQuality: profits.get(order.id)!.quality, payout: profits.get(order.id)!.payout === null ? null : Number(profits.get(order.id)!.payout), cogs: profits.get(order.id)!.cogs === null ? null : Number(profits.get(order.id)!.cogs) })),
    products: groupProducts(variants.map(variant => ({ id: variant.id, shopId: variant.shopId, sourceItemId: variant.sourceItemId, sourceModelId: variant.sourceModelId, name: variant.orderItems[0]?.name ?? variant.name, variationName: variant.variationName, nameObservedAt: (variant.orderItems[0]?.order.sourceCreatedAt ?? variant.createdAt).toISOString(), sku: variant.sku ?? "No SKU", cost: variant.costs[0] ? Number(variant.costs[0].amount) : null, units: unitsByVariant.get(variant.id) ?? 0 }))),
    returns: returns.map(value => ({ id: value.id, returnSn: value.returnSn, orderSn: value.order.orderSn, status: value.status, reportedAmount: value.reportedAmount ? Number(value.reportedAmount) : null, confirmedRefund: value.confirmedRefund ? Number(value.confirmedRefund) : null, updatedAt: value.sourceUpdatedAt.toISOString() })),
    runs: [],
    lastSyncedAt: state?.lastSuccessAt?.toISOString() ?? null, coverageFrom: state?.coverageFrom?.toISOString() ?? null, ordersCheckpoint: state?.checkpoint?.toISOString() ?? null, financeReady: eligible.length === covered.length && profitSummary.estimated === 0,
  };
}
