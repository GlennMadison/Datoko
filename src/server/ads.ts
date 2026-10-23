import { getDb } from "./db.ts";
import { getConfig, isDemo } from "./env.ts";
import { transactionLock } from "./queue.ts";
import { requireDashboardUser, demoDashboard } from "./dashboard.ts";
import { validateAdImport } from "./ads-import-schema.ts";
import { attributionLineKey, calculateRoas, type AdSourceReport, type AttributionEvidence, type RoasResult } from "../core/ads-roas.ts";
import { createTimeBuckets, dayStart, localDate, shiftDate, type ReportPeriod, type ReportQuery } from "../core/reporting-period.ts";
import { amountString, amountUnits } from "../core/money.ts";
import { digest } from "../core/security.ts";
import { AppError } from "../core/errors.ts";
import type { Prisma } from "../generated/prisma/client.ts";

export function adReportFilters(query: ReportQuery): { dataset?: string; campaign?: string } {
  const filters: { dataset?: string; campaign?: string } = {};
  for (const key of ["dataset", "campaign"] as const) {
    const value = query[key];
    if (Array.isArray(value) || (value?.length ?? 0) > 160) throw new AppError("INVALID_REPORT_FILTER", 400);
    if (value) filters[key] = value;
  }
  return filters;
}

export async function importAdReport(ownerId: string, value: unknown, now = new Date()) {
  if (isDemo()) throw new AppError("DEMO_READ_ONLY", 409);
  const input = validateAdImport(value, now);
  const config = getConfig();
  if (input.environment !== config.SHOPEE_ENV) throw new AppError("WRONG_ADS_ENVIRONMENT", 403);
  const db = getDb();
  const shop = await db.shop.findFirst({ where: { ownerId, sourceShopId: input.sourceShopId, environment: config.SHOPEE_ENV } });
  if (!shop) throw new AppError("SHOP_NOT_FOUND", 404);
  return db.$transaction(async tx => {
    await transactionLock(tx, `ad-import:${shop.id}:${input.datasetKey}`);
    const existing = await tx.adDataset.findUnique({ where: { shopId_sourceKey: { shopId: shop.id, sourceKey: input.datasetKey } } });
    if (existing && existing.basis !== input.basis) throw new AppError("ADS_BASIS_CHANGED", 409);
    const dataset = await tx.adDataset.upsert({ where: { shopId_sourceKey: { shopId: shop.id, sourceKey: input.datasetKey } }, create: { shopId: shop.id, sourceKey: input.datasetKey, name: input.datasetName, basis: input.basis }, update: { name: input.datasetName } });
    let imported = 0, unchanged = 0;
    for (const row of input.reports) {
      const sourceDigest = digest(JSON.stringify(row));
      const unique = { datasetId: dataset.id, campaignKey: row.campaignKey, grain: row.grain, startAt: new Date(row.start) };
      const previous = await tx.adReportBucket.findUnique({ where: { datasetId_campaignKey_grain_startAt: unique } });
      if (previous?.sourceDigest === sourceDigest) { unchanged++; continue; }
      if (previous && previous.sourceAsOf.getTime() >= Date.parse(row.sourceAsOf)) throw new AppError("STALE_ADS_REVISION", 409);
      // Conversion keys identify disjoint entitlements across the whole scope,
      // including periods outside the current dashboard selection.
      if (row.allocations.length && await tx.adAttributionAllocation.findFirst({ where: {
        sourceKey: { in: row.allocations.map(a => a.key) },
        report: { datasetId: dataset.id, campaignKey: row.campaignKey, grain: row.grain, ...(previous ? { id: { not: previous.id } } : {}) },
      }, select: { id: true } })) throw new AppError("DUPLICATE_ATTRIBUTION", 409);
      const data = { campaignName: row.campaignName, endAt: new Date(row.end), spend: row.spend, revenue: row.revenue, sourceAsOf: new Date(row.sourceAsOf), attributionComplete: row.attributionComplete, outcomesComplete: row.outcomesComplete, sourceDigest };
      const report = await tx.adReportBucket.upsert({ where: { datasetId_campaignKey_grain_startAt: unique }, create: { ...unique, ...data }, update: data });
      await tx.adAttributionAllocation.deleteMany({ where: { reportId: report.id } });
      if (row.allocations.length) await tx.adAttributionAllocation.createMany({ data: row.allocations.map(a => ({ reportId: report.id, sourceKey: a.key, orderSn: a.orderSn, sourceLineKey: a.lineKey, amount: a.amount, disposition: a.disposition, confirmedRefund: a.confirmedRefund, provisional: a.provisional, returnReferences: a.returnReferences })) });
      await tx.adReportRevision.create({ data: { reportId: report.id, digest: sourceDigest, sourceAsOf: new Date(row.sourceAsOf), importedBy: ownerId, payload: row } });
      imported++;
    }
    return { imported, unchanged, datasetKey: dataset.sourceKey };
  }, { timeout: 30_000 });
}

type StoredReport = AdSourceReport & { campaignKey: string; campaignName: string };
export type AdvertisementData = {
  mode: "demo" | "live"; period: ReportPeriod; datasets: { key: string; name: string; basis: string }[];
  datasetKey: string | null; campaignKey: string; basis: string | null;
  campaigns: { key: string; name: string; spend: string; originalRoas: string | null; realRoas: string | null }[];
  summary: RoasResult; points: { date: string; original: number | null; real: number | null; spend: number | null; revenue: number | null }[];
  coverage: { expected: number; available: number }; chartUnavailable: string | null;
};

function sourceCoverage(reports: AdSourceReport[], period: ReportPeriod, grain: "DAY" | "HOUR") {
  const start = Date.parse(period.fromISO), end = Math.min(Date.parse(period.toISO), Date.parse(period.effectiveToISO));
  const step = grain === "DAY" ? 86_400_000 : 3_600_000;
  const expected = Math.max(0, Math.ceil((end - start) / step));
  const keys = new Set(reports.map(row => row.start));
  let available = 0;
  for (let time = start; time < end; time += step) if (keys.has(new Date(time).toISOString())) available++;
  return { expected, available };
}
function applyCoverage(result: RoasResult, coverage: { available: number; expected: number }): RoasResult {
  return coverage.available < coverage.expected ? { ...result, retainedRevenue: null, excludedRevenue: null, realRoas: null, issues: [...new Set([...result.issues, "PERIOD_COVERAGE_INCOMPLETE"])], lines: result.lines.map(line => ({ ...line, retained: null, excluded: null })) } : result;
}

/** Shared reporting path: ratios derive from source sums, never averaged ratios. */
export function buildAdvertisementData(period: ReportPeriod, reports: StoredReport[], evidence: Map<string, AttributionEvidence>, datasets: AdvertisementData["datasets"], datasetKey: string | null, requestedCampaign?: string, mode: "demo" | "live" = "live"): AdvertisementData {
  const campaignKeys = [...new Set(reports.map(row => row.campaignKey))];
  const campaignKey = requestedCampaign || (campaignKeys.includes("shop") ? "shop" : campaignKeys[0] ?? "shop");
  const selected = reports.filter(row => row.campaignKey === campaignKey);
  const hasHours = selected.some(row => row.grain === "HOUR");
  const hasDays = selected.some(row => row.grain === "DAY");
  const resolved = period.interval === "auto" && !hasHours && hasDays && period.effectiveInterval.includes("hour") ? { ...period, effectiveInterval: "day" as const } : period;
  const wantsHours = resolved.effectiveInterval.includes("hour");
  const grain = wantsHours && hasHours ? "HOUR" : hasDays ? "DAY" : "HOUR";
  const source = selected.filter(row => row.grain === grain);
  const coverage = sourceCoverage(source, resolved, grain);
  const summary = applyCoverage(calculateRoas(source, evidence, { requireEvidence: true, scopeKey: `${campaignKey}:${grain}` }), coverage);
  const chartUnavailable = wantsHours && grain === "DAY" ? "This report contains daily source totals. Select Daily or Auto to see a supported graph." : null;
  const points = createTimeBuckets(resolved).map(bucket => {
    const rows = source.filter(row => row.start >= bucket.start && row.end <= bucket.end);
    const subperiod = { ...resolved, fromISO: bucket.start, toISO: bucket.end };
    const bucketCoverage = sourceCoverage(rows, subperiod, grain);
    const complete = !bucket.future && rows.length > 0 && bucketCoverage.available === bucketCoverage.expected;
    const values = complete ? calculateRoas(rows, evidence, { requireEvidence: true, scopeKey: `${campaignKey}:${grain}` }) : null;
    const ambiguous = summary.issues.some(issue => ["DUPLICATE_ATTRIBUTION", "CREDIT_EXCEEDS_ORDER_LINE", "OUTCOME_TOTAL_MISMATCH"].includes(issue));
    return { date: bucket.date, original: chartUnavailable || !values?.originalRoas ? null : Number(values.originalRoas), real: chartUnavailable || ambiguous || !values?.realRoas ? null : Number(values.realRoas), spend: chartUnavailable || !values ? null : Number(values.spend), revenue: chartUnavailable || ambiguous || !values?.retainedRevenue ? null : Number(values.retainedRevenue) };
  });
  const campaigns = campaignKeys.map(key => {
    const all = reports.filter(row => row.campaignKey === key);
    const chosenGrain = all.some(row => row.grain === "DAY") ? "DAY" : "HOUR";
    const rows = all.filter(row => row.grain === chosenGrain);
    const values = applyCoverage(calculateRoas(rows, evidence, { requireEvidence: true, scopeKey: `${key}:${chosenGrain}` }), sourceCoverage(rows, resolved, chosenGrain));
    return { key, name: all[0].campaignName, spend: values.spend, originalRoas: values.originalRoas, realRoas: values.realRoas };
  });
  if (!campaigns.some(row => row.key === campaignKey)) campaigns.push({ key: campaignKey, name: "Selected campaign (no data in this range)", spend: "0.0000", originalRoas: null, realRoas: null });
  return { mode, period: resolved, datasets, datasetKey, campaignKey, basis: datasets.find(row => row.key === datasetKey)?.basis ?? null, campaigns, summary, points, coverage, chartUnavailable };
}

function demoAdvertisement(period: ReportPeriod, requestedCampaign?: string): AdvertisementData {
  const orders = demoDashboard(period).orders;
  const evidence = new Map<string, AttributionEvidence>();
  for (const order of orders) evidence.set(attributionLineKey(order.orderSn, "demo-line"), { lineRevenue: order.merchandise, name: order.name, sku: order.sku, orderStatus: order.status, updatedAt: order.createdAt, returns: [] });
  const hourly = period.effectiveInterval.includes("hour");
  const currentDayHours = Math.floor((Date.now() - dayStart(period.today).getTime()) / 3_600_000) + 1;
  const sourceBuckets = createTimeBuckets({ ...period, effectiveInterval: hourly ? "hour" : "day" }, 10_000).filter(bucket => !bucket.future);
  const reports: StoredReport[] = sourceBuckets.map(bucket => {
    const matching = orders.filter(order => order.createdAt >= bucket.start && order.createdAt < bucket.end);
    return { key: bucket.key, campaignKey: "shop", campaignName: "Sample shop report", grain: hourly ? "HOUR" : "DAY", start: bucket.start, end: bucket.end, spend: localDate(new Date(bucket.start)) >= shiftDate(period.today, -5) ? hourly ? "1000" : localDate(new Date(bucket.start)) === period.today ? String(currentDayHours * 1000) : "24000" : "0", revenue: amountString(matching.reduce((sum, order) => sum + amountUnits(order.merchandise), 0n)), sourceAsOf: new Date().toISOString(), attributionComplete: true, outcomesComplete: true,
      allocations: matching.map(order => ({ key: order.id, orderSn: order.orderSn, lineKey: "demo-line", amount: order.merchandise, disposition: order.status === "CANCELLED" ? "CANCELLED" : "RETAINED", confirmedRefund: order.hasReturn ? "40000" : "0", provisional: order.status !== "COMPLETED" && order.status !== "CANCELLED", returnReferences: [] })),
    };
  });
  return buildAdvertisementData(period, reports, evidence, [{ key: "sample", name: "Illustrative ad report", basis: "PLACED_TOTAL" }], "sample", requestedCampaign, "demo");
}

async function readAdvertisement(db: Prisma.TransactionClient, ownerId: string, period: ReportPeriod, filters: { dataset?: string; campaign?: string }): Promise<AdvertisementData> {
  await db.$executeRaw`SET TRANSACTION READ ONLY`;
  const shop = await db.shop.findFirst({ where: { ownerId, environment: getConfig().SHOPEE_ENV } });
  const datasets = shop ? await db.adDataset.findMany({ where: { shopId: shop.id }, orderBy: { createdAt: "asc" }, take: 101 }) : [];
  if (datasets.length > 100) throw new AppError("TOO_MANY_ADS_DATASETS", 400);
  const dataset = datasets.find(row => row.sourceKey === filters.dataset) ?? datasets[0];
  if (filters.dataset && !datasets.some(row => row.sourceKey === filters.dataset)) throw new AppError("INVALID_ADS_DATASET", 400);
  const metadata = datasets.map(row => ({ key: row.sourceKey, name: row.name, basis: row.basis }));
  if (!dataset) return buildAdvertisementData(period, [], new Map(), metadata, null);
  const where = { datasetId: dataset.id, startAt: { gte: new Date(period.fromISO), lt: new Date(period.effectiveToISO) }, endAt: { lte: new Date(period.toISO) } };
  if (await db.adAttributionAllocation.count({ where: { report: where } }) > 50_000 || await db.adReportBucket.count({ where }) > 20_000) throw new AppError("REPORT_RANGE_TOO_LARGE", 400);
  const rows = await db.adReportBucket.findMany({ where, include: { allocations: true }, orderBy: { startAt: "asc" } });
  const sns = [...new Set(rows.flatMap(row => row.allocations.map(a => a.orderSn)))];
  const orders = sns.length ? await db.order.findMany({ where: { shopId: shop!.id, orderSn: { in: sns } }, include: { items: true, returns: true } }) : [];
  const evidence = new Map<string, AttributionEvidence>();
  for (const order of orders) for (const item of order.items) evidence.set(attributionLineKey(order.orderSn, item.sourceLineKey), { lineRevenue: amountString(amountUnits(item.paidUnitPrice.toString()) * BigInt(item.quantity)), name: item.name, sku: item.sku, orderBuyerTotal: order.totalAmount.toString(), orderStatus: order.status, updatedAt: order.sourceUpdatedAt.toISOString(), returns: order.returns.map(value => ({ reference: value.returnSn, updatedAt: value.sourceUpdatedAt.toISOString(), confirmedRefund: value.confirmedRefund?.toString() ?? null })) });
  // A narrow date selection must not hide excess credits for the same item in
  // another period. Campaigns and source grains remain independent scopes.
  if (sns.length) {
    const claimWhere = { report: { datasetId: dataset.id }, orderSn: { in: sns } };
    if (await db.adAttributionAllocation.count({ where: claimWhere }) > 50_000) throw new AppError("REPORT_RANGE_TOO_LARGE", 400);
    const credits = await db.adAttributionAllocation.findMany({ where: claimWhere, select: { orderSn: true, sourceLineKey: true, amount: true, report: { select: { campaignKey: true, grain: true } } } });
    for (const credit of credits) {
      const known = evidence.get(attributionLineKey(credit.orderSn, credit.sourceLineKey));
      if (!known) continue;
      const scope = `${credit.report.campaignKey}:${credit.report.grain}`;
      const amounts = known.creditedByScope ??= new Map();
      amounts.set(scope, (amounts.get(scope) ?? 0n) + amountUnits(credit.amount.toString()));
    }
  }
  const reports: StoredReport[] = rows.map(row => ({ key: row.id, campaignKey: row.campaignKey, campaignName: row.campaignName, grain: row.grain as "DAY" | "HOUR", start: row.startAt.toISOString(), end: row.endAt.toISOString(), spend: row.spend.toString(), revenue: row.revenue.toString(), sourceAsOf: row.sourceAsOf.toISOString(), attributionComplete: row.attributionComplete, outcomesComplete: row.outcomesComplete,
    allocations: row.allocations.map(a => ({ key: a.sourceKey, orderSn: a.orderSn, lineKey: a.sourceLineKey, amount: a.amount.toString(), disposition: a.disposition as "RETAINED" | "CANCELLED" | "RETURNED", confirmedRefund: a.confirmedRefund.toString(), provisional: a.provisional, returnReferences: a.returnReferences })),
  }));
  return buildAdvertisementData(period, reports, evidence, metadata, dataset.sourceKey, filters.campaign);
}

export async function advertisementForOwner(ownerId: string, period: ReportPeriod, filters: { dataset?: string; campaign?: string } = {}): Promise<AdvertisementData> {
  return getDb().$transaction(tx => readAdvertisement(tx, ownerId, period, filters), { isolationLevel: "RepeatableRead", timeout: 30_000 });
}

export async function getAdvertisementData(period: ReportPeriod, filters: { dataset?: string; campaign?: string } = {}) {
  if (isDemo()) {
    if (filters.dataset && filters.dataset !== "sample") throw new AppError("INVALID_ADS_DATASET", 400);
    return demoAdvertisement(period, filters.campaign);
  }
  const actor = await requireDashboardUser();
  return advertisementForOwner(actor.ownerId, period, filters);
}
