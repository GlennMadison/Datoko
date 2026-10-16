import { getDb } from "./db.ts";
import { getConfig, isDemo, loginMissing } from "./env.ts";
import { requireOwner } from "./auth.ts";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "../core/errors.ts";

export type OrderRow = { id: string; orderSn: string; name: string; sku: string; quantity: number; total: number; status: string; createdAt: string; hasReturn: boolean; costMissing: boolean };
export type ProductRow = { id: string; name: string; sku: string; cost: number | null; units: number };
export type ReturnRow = { id: string; returnSn: string; orderSn: string; status: string; reportedAmount: number | null; confirmedRefund: number | null; updatedAt: string };
export type RunRow = { id: string; status: string; reason: string; processed: number; errorCode: string | null; createdAt: string };
export type DashboardData = {
  mode: "demo" | "live";
  shop: { id: string; name: string; sourceShopId: string; status: string; environment: string } | null;
  metrics: { sales: number; placedValue: number; orders: number; completed: number; cancelled: number; profit: number | null; refunds: number | null };
  trend: { date: string; sales: number; orders: number }[];
  orders: OrderRow[];
  products: ProductRow[];
  returns: ReturnRow[];
  runs: RunRow[];
  lastSyncedAt: string | null;
  coverageFrom: string | null;
  ordersCheckpoint: string | null;
  financeReady: boolean;
};

function demo(): DashboardData {
  const products: ProductRow[] = [
    { id: "sample-1", name: "Desktop speaker stand", sku: "SPK-BLK", cost: 46000, units: 34 },
    { id: "sample-2", name: "Universal soundbar stand", sku: "SND-BLK", cost: 38000, units: 22 },
    { id: "sample-3", name: "Ambient table lamp", sku: "LMP-IVY", cost: 72000, units: 16 },
    { id: "sample-4", name: "Compact speaker stand", sku: "CMP-WHT", cost: null, units: 11 },
  ];
  const orders: OrderRow[] = Array.from({ length: 12 }, (_, index) => {
    const product = products[index % products.length];
    return { id: `sample-${index}`, orderSn: `2610${String(15 - index).padStart(2, "0")}D${String(index + 1024)}`, name: product.name, sku: product.sku, quantity: index % 5 === 0 ? 2 : 1, total: [110000, 98000, 175000, 89000][index % 4], status: index === 4 ? "CANCELLED" : index < 2 ? "READY_TO_SHIP" : "COMPLETED", createdAt: new Date(Date.UTC(2026, 9, 15 - index, 3)).toISOString(), hasReturn: index === 3, costMissing: product.cost === null };
  });
  return {
    mode: "demo", shop: { id: "demo", name: "Sample workspace", sourceShopId: "—", status: "NOT_CONNECTED", environment: "sandbox" },
    metrics: { sales: 8240000, placedValue: 9150000, orders: 83, completed: 72, cancelled: 6, profit: 2630000, refunds: 110000 },
    trend: [180000, 340000, 290000, 520000, 390000, 610000, 580000, 460000, 790000, 640000, 900000, 740000, 860000, 940000].map((sales, index) => ({ date: `${index + 2} Oct`, sales, orders: Math.round(sales / 110000) })),
    orders, products,
    returns: [{ id: "sample-return", returnSn: "RETURN-DEMO-001", orderSn: orders[3].orderSn, status: "RESOLVED", reportedAmount: 110000, confirmedRefund: 110000, updatedAt: "2026-10-15T03:00:00Z" }],
    runs: [], lastSyncedAt: null, coverageFrom: null, ordersCheckpoint: null, financeReady: false,
  };
}

export async function getDashboardData(days = 30): Promise<DashboardData> {
  if (isDemo()) return demo();
  if (loginMissing().length) redirect("/setup");
  const actor = await requireOwner(await headers()).catch(error => {
    if (error instanceof AppError && ["SIGN_IN_REQUIRED", "OWNER_ONLY"].includes(error.code)) redirect("/login");
    throw error;
  });
  const db = getDb();
  const config = getConfig();
  const shop = await db.shop.findFirst({ where: { ownerId: actor.ownerId, environment: config.SHOPEE_ENV }, include: { connection: true, syncStates: true } });
  if (!shop) return { mode: "live", shop: null, metrics: { sales: 0, placedValue: 0, orders: 0, completed: 0, cancelled: 0, profit: null, refunds: null }, orders: [], products: [], returns: [], runs: [], trend: [], lastSyncedAt: null, coverageFrom: null, ordersCheckpoint: null, financeReady: false };
  const since = new Date(Date.now() - days * 86_400_000);
  const [orders, variants, returns, runs] = await Promise.all([
    db.order.findMany({ where: { shopId: shop.id, sourceCreatedAt: { gte: since } }, include: { items: true, returns: { select: { id: true } } }, orderBy: { sourceCreatedAt: "desc" } }),
    db.productVariant.findMany({ where: { shopId: shop.id }, include: { costs: { where: { effectiveAt: { lte: new Date() } }, orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }], take: 1 }, orderItems: { where: { order: { sourceCreatedAt: { gte: since }, status: "COMPLETED" } }, select: { quantity: true } } } }),
    db.returnCase.findMany({ where: { shopId: shop.id }, include: { order: { select: { orderSn: true } } }, orderBy: { sourceUpdatedAt: "desc" }, take: 100 }),
    db.syncRun.findMany({ where: { shopId: shop.id }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const trend = new Map<string, { sales: number; orders: number }>();
  for (const order of orders) {
    const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: config.BUSINESS_TIMEZONE }).format(order.sourceCreatedAt);
    const point = trend.get(date) ?? { sales: 0, orders: 0 };
    if (order.status === "COMPLETED") point.sales += Number(order.merchandiseAmount);
    point.orders++;
    trend.set(date, point);
  }
  const state = shop.syncStates.find(state => state.resource === "orders");
  return {
    mode: "live", shop: { id: shop.id, name: shop.name, sourceShopId: shop.sourceShopId, status: shop.connection?.status ?? "DISCONNECTED", environment: shop.environment },
    metrics: { orders: orders.length, completed: orders.filter(order => order.status === "COMPLETED").length, cancelled: orders.filter(order => order.status === "CANCELLED").length, sales: orders.filter(order => order.status === "COMPLETED").reduce((sum, order) => sum + Number(order.merchandiseAmount), 0), placedValue: orders.reduce((sum, order) => sum + Number(order.totalAmount), 0), profit: null, refunds: null },
    trend: Array.from(trend, ([date, value]) => ({ date, ...value })).reverse(),
    orders: orders.map(order => ({ id: order.id, orderSn: order.orderSn, name: order.items[0]?.name ?? "Order", sku: order.items[0]?.sku ?? "—", quantity: order.items.reduce((sum, item) => sum + item.quantity, 0), total: Number(order.totalAmount), status: order.status, createdAt: order.sourceCreatedAt.toISOString(), hasReturn: order.returns.length > 0, costMissing: order.items.some(item => item.costSnapshot === null) })),
    products: variants.map(variant => ({ id: variant.id, name: variant.name, sku: variant.sku ?? "No SKU", cost: variant.costs[0] ? Number(variant.costs[0].amount) : null, units: variant.orderItems.reduce((sum, item) => sum + item.quantity, 0) })).sort((a, b) => b.units - a.units),
    returns: returns.map(value => ({ id: value.id, returnSn: value.returnSn, orderSn: value.order.orderSn, status: value.status, reportedAmount: value.reportedAmount ? Number(value.reportedAmount) : null, confirmedRefund: value.confirmedRefund ? Number(value.confirmedRefund) : null, updatedAt: value.sourceUpdatedAt.toISOString() })),
    runs: runs.map(run => ({ id: run.id, status: run.status, reason: run.reason, processed: run.processed, errorCode: run.errorCode, createdAt: run.createdAt.toISOString() })),
    lastSyncedAt: state?.lastSuccessAt?.toISOString() ?? null, coverageFrom: state?.coverageFrom?.toISOString() ?? null, ordersCheckpoint: state?.checkpoint?.toISOString() ?? null, financeReady: false,
  };
}
