import { groupProducts, type ProductGroup, type ProductVariantRow } from "../core/products.ts";
import { getDb } from "./db.ts";
import { getConfig, isDemo, loginMissing } from "./env.ts";
import { requireUser } from "./auth.ts";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "../core/errors.ts";
import { dayStart, periodContains, resolveReportPeriod, shiftDate, type ReportPeriod } from "../core/reporting-period.ts";
import { activityTrend, type ActivityPoint } from "./reporting.ts";

export type OrderRow = { id: string; orderSn: string; name: string; sku: string; quantity: number; total: number; merchandise: string; status: string; createdAt: string; hasReturn: boolean; costMissing: boolean };
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
};

export function demoDashboard(period: ReportPeriod): DashboardData {
  const sampleProducts = [
    { id: "sample-1", name: "Desktop speaker stand", sku: "SPK-BLK", cost: 46000, units: 34 },
    { id: "sample-2", name: "Universal soundbar stand", sku: "SND-BLK", cost: 38000, units: 22 },
    { id: "sample-3", name: "Ambient table lamp", sku: "LMP-IVY", cost: 72000, units: 16 },
    { id: "sample-4", name: "Compact speaker stand", sku: "CMP-WHT", cost: null, units: 11 },
  ];
  const products: ProductRow[] = sampleProducts.map((product, index) => ({ ...product, shopId: "demo", sourceItemId: String(1000 + index), sourceModelId: "0", nameObservedAt: "2026-01-01T00:00:00.000Z" }));
  products.push({ ...products[0], id: "sample-5", sourceModelId: "1", sku: "SPK-WHT", cost: 48000, units: 0, nameObservedAt: "2026-01-02T00:00:00.000Z" });
  const todayStart = dayStart(period.today).getTime();
  const currentHour = Math.max(0, Math.floor((Date.now() - todayStart) / 3_600_000));
  const allOrders: OrderRow[] = Array.from({ length: 12 }, (_, index) => {
    const product = products[index % sampleProducts.length];
    const total = [110000, 98000, 175000, 89000][index % 4];
    const createdAt = new Date(dayStart(shiftDate(period.today, -Math.floor(index / 2))).getTime() + Math.min(currentHour, index % 2 ? 15 : 9) * 3_600_000).toISOString();
    return { id: `sample-${index}`, orderSn: `DEMO-${index + 1024}`, name: product.name, sku: product.sku, quantity: index % 5 === 0 ? 2 : 1, total, merchandise: String(total), status: index === 4 ? "CANCELLED" : index < 2 ? "READY_TO_SHIP" : "COMPLETED", createdAt, hasReturn: index === 3, costMissing: product.cost === null };
  });
  const orders = allOrders.filter(order => periodContains(period, order.createdAt));
  const returns = [{ id: "sample-return", returnSn: "RETURN-DEMO-001", orderSn: allOrders[3].orderSn, status: "RESOLVED", reportedAmount: 40000, confirmedRefund: 40000, updatedAt: new Date(Math.min(Date.now() - 1000, todayStart + 8 * 3_600_000)).toISOString() }].filter(value => periodContains(period, value.updatedAt));
  for (const product of products) product.units = orders.filter(order => order.sku === product.sku && order.status === "COMPLETED").reduce((sum, order) => sum + order.quantity, 0);
  const completed = orders.filter(order => order.status === "COMPLETED");
  return {
    mode: "demo", shop: { id: "demo", name: "Sample workspace", sourceShopId: "-", status: "NOT_CONNECTED", environment: "sandbox" },
    metrics: { sales: completed.reduce((sum, order) => sum + order.total, 0), placedValue: orders.reduce((sum, order) => sum + order.total, 0), orders: orders.length, completed: completed.length, cancelled: orders.filter(order => order.status === "CANCELLED").length, profit: null, refunds: returns.reduce((sum, value) => sum + value.confirmedRefund, 0) },
    trend: activityTrend(period, orders, returns.map(value => ({ ...value, confirmedRefund: String(value.confirmedRefund) }))),
    orders, products: groupProducts(products),
    returns,
    runs: [], lastSyncedAt: null, coverageFrom: null, ordersCheckpoint: null, financeReady: false,
  };
}

export async function requireDashboardUser() {
  if (loginMissing().length) redirect("/setup");
  return requireUser(await headers()).catch(error => {
    if (error instanceof AppError && ["SIGN_IN_REQUIRED", "AUTH_METHOD_REQUIRED"].includes(error.code)) redirect("/login");
    throw error;
  });
}

export async function getDashboardData(selection: ReportPeriod | number = 30): Promise<DashboardData> {
  const period = typeof selection === "number" ? resolveReportPeriod({ days: String(selection) }) : selection;
  if (isDemo()) return demoDashboard(period);
  const actor = await requireDashboardUser();
  const db = getDb();
  const config = getConfig();
  const shop = await db.shop.findFirst({ where: { ownerId: actor.ownerId, environment: config.SHOPEE_ENV }, include: { connection: true, syncStates: true } });
  if (!shop) return { mode: "live", shop: null, metrics: { sales: 0, placedValue: 0, orders: 0, completed: 0, cancelled: 0, profit: null, refunds: null }, orders: [], products: [], returns: [], runs: [], trend: [], lastSyncedAt: null, coverageFrom: null, ordersCheckpoint: null, financeReady: false };
  const range = { gte: new Date(period.fromISO), lt: new Date(period.effectiveToISO) };
  const [orderCount, returnCount] = await Promise.all([
    db.order.count({ where: { shopId: shop.id, sourceCreatedAt: range } }),
    db.returnCase.count({ where: { shopId: shop.id, sourceUpdatedAt: range } }),
  ]);
  if (orderCount > 50_000 || returnCount > 50_000) throw new AppError("REPORT_RANGE_TOO_LARGE", 400);
  const [orders, variants, returns, runs] = await Promise.all([
    db.order.findMany({ where: { shopId: shop.id, sourceCreatedAt: range }, include: { items: true, returns: { select: { id: true } } }, orderBy: { sourceCreatedAt: "desc" } }),
    db.productVariant.findMany({ where: { shopId: shop.id }, include: { costs: { where: { effectiveAt: { lte: new Date() } }, orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }], take: 1 }, orderItems: { orderBy: [{ order: { sourceCreatedAt: "desc" } }, { id: "asc" }], take: 1, select: { name: true, order: { select: { sourceCreatedAt: true } } } } } }),
    db.returnCase.findMany({ where: { shopId: shop.id, sourceUpdatedAt: range }, include: { order: { select: { orderSn: true } } }, orderBy: { sourceUpdatedAt: "desc" } }),
    db.syncRun.findMany({ where: { shopId: shop.id }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const trend = activityTrend(period, orders.map(order => ({ createdAt: order.sourceCreatedAt.toISOString(), status: order.status, merchandise: order.merchandiseAmount.toString(), quantity: order.items.reduce((sum, item) => sum + item.quantity, 0) })), returns.map(value => ({ updatedAt: value.sourceUpdatedAt.toISOString(), confirmedRefund: value.confirmedRefund?.toString() ?? null })));
  const unitsByVariant = new Map<string, number>();
  for (const order of orders) {
    if (order.status !== "COMPLETED") continue;
    for (const item of order.items) unitsByVariant.set(item.variantId, (unitsByVariant.get(item.variantId) ?? 0) + item.quantity);
  }
  const state = shop.syncStates.find(state => state.resource === "orders");
  return {
    mode: "live", shop: { id: shop.id, name: shop.name, sourceShopId: shop.sourceShopId, status: shop.connection?.status ?? "DISCONNECTED", environment: shop.environment },
    metrics: { orders: orders.length, completed: orders.filter(order => order.status === "COMPLETED").length, cancelled: orders.filter(order => order.status === "CANCELLED").length, sales: orders.filter(order => order.status === "COMPLETED").reduce((sum, order) => sum + Number(order.merchandiseAmount), 0), placedValue: orders.reduce((sum, order) => sum + Number(order.totalAmount), 0), profit: null, refunds: null },
    trend,
    orders: orders.map(order => ({ id: order.id, orderSn: order.orderSn, name: order.items[0]?.name ?? "Order", sku: order.items[0]?.sku ?? "-", quantity: order.items.reduce((sum, item) => sum + item.quantity, 0), total: Number(order.totalAmount), merchandise: order.merchandiseAmount.toString(), status: order.status, createdAt: order.sourceCreatedAt.toISOString(), hasReturn: order.returns.length > 0, costMissing: order.items.some(item => item.costSnapshot === null) })),
    products: groupProducts(variants.map(variant => ({ id: variant.id, shopId: variant.shopId, sourceItemId: variant.sourceItemId, sourceModelId: variant.sourceModelId, name: variant.orderItems[0]?.name ?? variant.name, nameObservedAt: (variant.orderItems[0]?.order.sourceCreatedAt ?? variant.createdAt).toISOString(), sku: variant.sku ?? "No SKU", cost: variant.costs[0] ? Number(variant.costs[0].amount) : null, units: unitsByVariant.get(variant.id) ?? 0 }))),
    returns: returns.map(value => ({ id: value.id, returnSn: value.returnSn, orderSn: value.order.orderSn, status: value.status, reportedAmount: value.reportedAmount ? Number(value.reportedAmount) : null, confirmedRefund: value.confirmedRefund ? Number(value.confirmedRefund) : null, updatedAt: value.sourceUpdatedAt.toISOString() })),
    runs: runs.map(run => ({ id: run.id, status: run.status, reason: run.reason, processed: run.processed, errorCode: run.errorCode, createdAt: run.createdAt.toISOString() })),
    lastSyncedAt: state?.lastSuccessAt?.toISOString() ?? null, coverageFrom: state?.coverageFrom?.toISOString() ?? null, ordersCheckpoint: state?.checkpoint?.toISOString() ?? null, financeReady: false,
  };
}
