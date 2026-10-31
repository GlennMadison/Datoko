import { Prisma } from "../generated/prisma/client.ts";
import { createTimeBuckets, type ReportPeriod, type ReportQuery, resolveReportPeriod } from "../core/reporting-period.ts";
import { orderPage } from "../core/order-pagination.ts";
import { calculateOrderProfit, readSettlement } from "../core/profit.ts";
import { groupProducts } from "../core/products.ts";
import { AppError } from "../core/errors.ts";
import { demoDashboard, requireDashboardUser, type OrderRow } from "./dashboard.ts";
import { getConfig, isDemo } from "./env.ts";
import { getDb } from "./db.ts";
import { reportShop, cachedReport, type ReportShop } from "./report-context.ts";
import { reportOrders, reportProducts, reportReturns } from "./report-queries.ts";
import { activityTrend } from "./reporting.ts";

async function ownedShop() {
  const actor = await requireDashboardUser();
  return reportShop(actor.ownerId, getConfig().SHOPEE_ENV);
}
function workspace(shop: ReportShop | null) {
  const state = shop?.syncStates.find(s => s.resource === "orders");
  return { mode: "live" as const, shop: shop ? { id: shop.id, name: shop.name, sourceShopId: shop.sourceShopId, environment: shop.environment, status: shop.connection?.status ?? "DISCONNECTED" } : null,
    lastSyncedAt: state?.lastSuccessAt?.toISOString() ?? null, coverageFrom: state?.coverageFrom?.toISOString() ?? null, ordersCheckpoint: state?.checkpoint?.toISOString() ?? null };
}
export async function getWorkspaceData() {
  if (isDemo()) return demoDashboard(resolveReportPeriod({}));
  const shop = await ownedShop();
  const runs = shop ? await getDb().syncRun.findMany({ where: { shopId: shop.id }, orderBy: { createdAt: "desc" }, take: 30,
    select: { id: true, status: true, reason: true, processed: true, errorCode: true, createdAt: true } }) : [];
  return { ...workspace(shop), runs: runs.map(run => ({ ...run, createdAt: run.createdAt.toISOString() })) };
}

// Filtering and chart aggregation use the same parameterized predicate.
function orderWhere(shopId: string, period: ReportPeriod, search = "", status = "") {
  const pattern = "%" + search.replace(/[\\%_]/g, "\\$&") + "%";
  return Prisma.sql`o."shopId" = ${shopId} AND o."sourceCreatedAt" >= ${new Date(period.fromISO)} AND o."sourceCreatedAt" < ${new Date(period.effectiveToISO)}
    ${status ? Prisma.sql`AND o.status = ${status}` : Prisma.empty}
    ${search ? Prisma.sql`AND (o."orderSn" ILIKE ${pattern} OR EXISTS (SELECT 1 FROM order_items i WHERE i."orderId" = o.id
      AND (i.name ILIKE ${pattern} OR i."variationName" ILIKE ${pattern} OR i.sku ILIKE ${pattern})))` : Prisma.empty}`;
}

async function countTrend(db: Prisma.TransactionClient, period: ReportPeriod, where: Prisma.Sql) {
  const buckets = createTimeBuckets(period);
  const rows = await db.$queryRaw<{ key: string; orders: number; units: number }[]>`
    WITH buckets(key, start_at, end_at) AS (VALUES ${Prisma.join(buckets.map(b => Prisma.sql`(${b.key}, ${new Date(b.start)}::timestamptz, ${new Date(b.end)}::timestamptz)`))})
    SELECT b.key, count(DISTINCT o.id)::int AS orders,
      coalesce(sum(i.quantity) FILTER (WHERE o.status = 'COMPLETED'), 0)::int AS units
    FROM buckets b LEFT JOIN orders o ON o."sourceCreatedAt" >= b.start_at AND o."sourceCreatedAt" < b.end_at
      AND (${where}) AND (o.status = 'CANCELLED' OR (o.status <> 'UNPAID' AND o."paymentStatus" <> 'UNPAID'))
    LEFT JOIN order_items i ON i."orderId" = o.id GROUP BY b.key`;
  const counts = new Map(rows.map(row => [row.key, row]));
  return activityTrend(period, []).map(point => ({ ...point, orders: point.orders === null ? null : counts.get(point.key)?.orders ?? 0,
    completedUnits: point.completedUnits === null ? null : counts.get(point.key)?.units ?? 0 }));
}

export async function getProductData(period: ReportPeriod) {
  if (isDemo()) return demoDashboard(period);
  const shop = await ownedShop();
  if (!shop) return { ...workspace(shop), products: [], trend: activityTrend(period, []) };
  return cachedReport(shop, "products", period, null, async () => {
    const db = getDb();
    const [variants, counts, trend] = await Promise.all([
      reportProducts(shop.id),
      db.$queryRaw<{ variantId: string; units: number }[]>`SELECT i."variantId", sum(i.quantity)::int AS units FROM order_items i
        JOIN orders o ON o.id = i."orderId" WHERE ${orderWhere(shop.id, period)} AND o.status = 'COMPLETED' GROUP BY i."variantId"`,
      countTrend(db, period, orderWhere(shop.id, period)),
    ]);
    const units = new Map(counts.map(row => [row.variantId, row.units]));
    return { ...workspace(shop), trend, products: groupProducts(variants.map(v => ({ id: v.id, shopId: v.shopId, sourceItemId: v.sourceItemId,
      sourceModelId: v.sourceModelId, name: v.orderItems[0]?.name ?? v.name, variationName: v.variationName,
      nameObservedAt: (v.orderItems[0]?.order.sourceCreatedAt ?? v.createdAt).toISOString(), sku: v.sku ?? "No SKU",
      cost: v.costs[0] ? Number(v.costs[0].amount) : null, units: units.get(v.id) ?? 0 }))) };
  });
}

export async function getReturnData(period: ReportPeriod) {
  if (isDemo()) return demoDashboard(period);
  const shop = await ownedShop();
  if (!shop) return { ...workspace(shop), returns: [], trend: activityTrend(period, []), returnsReady: false, returnsError: null };
  return cachedReport(shop, "returns", period, null, async () => {
    const db = getDb();
    if (await db.returnCase.count({ where: { shopId: shop.id, sourceUpdatedAt: { gte: new Date(period.fromISO), lt: new Date(period.effectiveToISO) } } }) > 50_000) throw new AppError("REPORT_RANGE_TOO_LARGE", 400);
    const rows = await reportReturns(db, shop.id, period.fromISO, period.effectiveToISO);
    const returns = rows.map(r => ({ id: r.id, returnSn: r.returnSn, orderSn: r.order.orderSn, status: r.status,
      reportedAmount: r.reportedAmount === null ? null : Number(r.reportedAmount), confirmedRefund: r.confirmedRefund === null ? null : Number(r.confirmedRefund), updatedAt: r.sourceUpdatedAt.toISOString() }));
    const state = shop.syncStates.find(s => s.resource === "returns");
    return { ...workspace(shop), returns, returnsReady: !!state?.lastSuccessAt && !state.lastErrorCode, returnsError: state?.lastErrorCode ?? null,
      trend: activityTrend(period, [], rows.map(r => ({ updatedAt: r.sourceUpdatedAt.toISOString(), confirmedRefund: r.confirmedRefund?.toString() ?? null }))) };
  });
}

export async function ordersForShop(shop: ReportShop, period: ReportPeriod, query: ReportQuery) {
  const options = orderPage(query), where = orderWhere(shop.id, period, options.search, options.status);
  return getDb().$transaction(async db => {
    const [count] = await db.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM orders o WHERE ${where}`;
    const total = count.total;
    if (total > 50_000) throw new AppError("REPORT_RANGE_TOO_LARGE", 400);
    const page = Math.min(options.page, Math.max(1, Math.ceil(total / options.pageSize)));
    const direction = options.direction === "asc" ? Prisma.sql`ASC NULLS FIRST` : Prisma.sql`DESC NULLS LAST`;
    const columns = { name: Prisma.sql`first_item.name`, createdAt: Prisma.sql`o."sourceCreatedAt"`, total: Prisma.sql`o."totalAmount"`,
      profit: Prisma.sql`CASE WHEN o.status NOT IN ('CANCELLED', 'IN_CANCEL', 'UNPAID') AND cost.missing = 0
        AND snapshot.amounts->>'payout' ~ '^-?[0-9]{1,16}(\\.[0-9]{1,4})?$'
        THEN (snapshot.amounts->>'payout')::numeric - cost.cogs END` };
    const ids = await db.$queryRaw<{ id: string }[]>`SELECT o.id FROM orders o
      LEFT JOIN LATERAL (SELECT name FROM order_items WHERE "orderId" = o.id ORDER BY id LIMIT 1) first_item ON true
      ${options.sort === "profit" ? Prisma.sql`LEFT JOIN LATERAL (SELECT amounts FROM financial_snapshots WHERE "orderId" = o.id AND source = 'SHOPEE_ESCROW' ORDER BY revision DESC LIMIT 1) snapshot ON true
      LEFT JOIN LATERAL (SELECT sum("costSnapshot" * quantity) AS cogs, count(*) FILTER (WHERE "costSnapshot" IS NULL) AS missing FROM order_items WHERE "orderId" = o.id) cost ON true` : Prisma.empty}
      WHERE ${where} ORDER BY ${columns[options.sort]} ${direction}, o.id ASC LIMIT ${options.pageSize} OFFSET ${(page - 1) * options.pageSize}`;
    const [orders, trend] = await Promise.all([reportOrders(db, shop.id, period.fromISO, period.effectiveToISO, ids.map(r => r.id)), countTrend(db, period, where)]);
    const mapped = new Map(orders.map(order => {
      const profit = calculateOrderProfit({ status: order.status, items: order.items.map(i => ({ quantity: i.quantity, costSnapshot: i.costSnapshot?.toString() ?? null, costQuality: i.costQuality })) }, readSettlement(order.financialSnapshots[0]?.amounts));
      const row: OrderRow = { id: order.id, orderSn: order.orderSn, name: order.items[0]?.name ?? "Order", variationName: order.items[0]?.variationName,
        sku: order.items[0]?.sku ?? "-", quantity: order.items.reduce((sum, i) => sum + i.quantity, 0), total: Number(order.totalAmount), merchandise: order.merchandiseAmount.toString(),
        status: order.status, paymentStatus: order.paymentStatus, createdAt: order.sourceCreatedAt.toISOString(), hasReturn: order.returns.length > 0,
        costMissing: order.items.some(i => i.costSnapshot === null), profit: profit.profit === null ? null : Number(profit.profit), profitQuality: profit.quality,
        payout: profit.payout === null ? null : Number(profit.payout), cogs: profit.cogs === null ? null : Number(profit.cogs) };
      return [order.id, row];
    }));
    return { orders: ids.map(r => mapped.get(r.id)!), trend, total, pagination: { page, pageSize: options.pageSize, sort: options.sort, direction: options.direction } };
  }, { isolationLevel: "RepeatableRead", timeout: 30_000 });
}

export async function getOrderData(period: ReportPeriod, query: ReportQuery) {
  const options = orderPage(query);
  if (isDemo()) {
    const data = demoDashboard(period);
    const matching = data.orders.filter(o => (!options.status || options.status === o.status) && `${o.orderSn} ${o.name} ${o.variationName ?? ""} ${o.sku}`.toLowerCase().includes(options.search.toLowerCase()));
    const sorted = [...matching].sort((a, b) => {
      const diff = options.sort === "name" ? a.name.localeCompare(b.name) : options.sort === "total" ? a.total - b.total : options.sort === "profit" ? (a.profit ?? -Infinity) - (b.profit ?? -Infinity) : Date.parse(a.createdAt) - Date.parse(b.createdAt);
      return (options.direction === "asc" ? diff : -diff) || a.id.localeCompare(b.id);
    });
    const page = Math.min(options.page, Math.max(1, Math.ceil(sorted.length / options.pageSize)));
    return { orders: sorted.slice((page - 1) * options.pageSize, page * options.pageSize), total: matching.length, trend: activityTrend(period, matching), pagination: { ...options, page } };
  }
  const shop = await ownedShop();
  if (!shop) return { orders: [], total: 0, trend: activityTrend(period, []), pagination: { ...options, page: 1 } };
  return cachedReport(shop, "order-list", period, options, () => ordersForShop(shop, period, query));
}
