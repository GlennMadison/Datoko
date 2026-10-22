import { z } from "zod";
import { amountString, amountUnits } from "../core/money.ts";
import { AppError } from "../core/errors.ts";
import { calculateRoas, type AdSourceReport } from "../core/ads-roas.ts";
import { dayStart, localDate } from "../core/reporting-period.ts";

export const MAX_AD_IMPORT_BYTES = 2 * 1024 * 1024;
const id = z.string().min(1).max(160).regex(/^[A-Za-z0-9:_./-]+$/);
const money = z.string().regex(/^\d{1,16}(?:\.\d{1,4})?$/);
const text = z.string().min(1).max(100).regex(/^[^\x00-\x1f\x7f]+$/);
const allocation = z.object({
  key: id, orderSn: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), lineKey: id,
  amount: money, disposition: z.enum(["RETAINED", "CANCELLED", "RETURNED"]),
  confirmedRefund: money, provisional: z.boolean(), returnReferences: z.array(id).max(30),
}).strict();
const row = z.object({
  campaignKey: id, campaignName: text, grain: z.enum(["DAY", "HOUR"]),
  start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }),
  spend: money, revenue: money, sourceAsOf: z.iso.datetime({ offset: true }),
  attributionComplete: z.boolean(), outcomesComplete: z.boolean(),
  allocations: z.array(allocation).max(2000),
}).strict();
export const adImportSchema = z.object({
  version: z.literal(1), sourceShopId: z.string().regex(/^\d{1,20}$/), environment: z.enum(["sandbox", "production"]),
  datasetKey: id, datasetName: text, basis: z.enum(["PLACED_TOTAL", "PLACED_DIRECT", "CONFIRMED_TOTAL", "CONFIRMED_DIRECT"]),
  reports: z.array(row).min(1).max(200),
}).strict();
export type AdImport = z.infer<typeof adImportSchema>;

export function validateAdImport(value: unknown, now = new Date()): AdImport {
  const parsed = adImportSchema.safeParse(value);
  if (!parsed.success) throw new AppError("INVALID_AD_REPORT", 400);
  const data = parsed.data;
  if (data.reports.reduce((n, report) => n + report.allocations.length, 0) > 10_000) throw new AppError("ADS_IMPORT_TOO_LARGE", 413);
  const groups = new Map<string, AdSourceReport[]>();
  const metadata = new Map<string, string>();
  for (const report of data.reports) {
    const start = new Date(report.start), end = new Date(report.end), asOf = new Date(report.sourceAsOf);
    const aligned = report.grain === "DAY" ? dayStart(localDate(start)).getTime() : Math.floor((start.getTime() + 25_200_000) / 3_600_000) * 3_600_000 - 25_200_000;
    if (start.getTime() !== aligned || end.getTime() - start.getTime() !== (report.grain === "DAY" ? 86_400_000 : 3_600_000) || start > now || asOf < start || asOf.getTime() > now.getTime() + 60_000) throw new AppError("INVALID_ADS_PERIOD", 400);
    // Normalize timestamps so offset-equivalent imports share the same hash/key.
    report.start = start.toISOString(); report.end = end.toISOString(); report.sourceAsOf = asOf.toISOString();
    report.spend = amountString(amountUnits(report.spend)); report.revenue = amountString(amountUnits(report.revenue));
    report.allocations.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    for (const allocation of report.allocations) {
      allocation.amount = amountString(amountUnits(allocation.amount)); allocation.confirmedRefund = amountString(amountUnits(allocation.confirmedRefund));
      allocation.returnReferences.sort();
    }
    if (report.allocations.some(a => amountUnits(a.confirmedRefund) > amountUnits(a.amount))) throw new AppError("INVALID_ADS_OUTCOME", 400);
    const group = `${report.campaignKey}:${report.grain}`;
    if (metadata.has(report.campaignKey) && metadata.get(report.campaignKey) !== report.campaignName) throw new AppError("ADS_CAMPAIGN_METADATA_CONFLICT", 400);
    metadata.set(report.campaignKey, report.campaignName);
    const list = groups.get(group) ?? [];
    list.push({ ...report, key: `${group}:${report.start}` });
    groups.set(group, list);
  }
  for (const reports of groups.values()) {
    const result = calculateRoas(reports, undefined, { now });
    if (result.issues.includes("DUPLICATE_ATTRIBUTION")) throw new AppError("DUPLICATE_ATTRIBUTION", 400);
    for (const report of reports) {
      const credited = report.allocations.reduce((sum, a) => sum + amountUnits(a.amount), 0n);
      if (credited > amountUnits(report.revenue) || (report.attributionComplete && amountUnits(report.revenue) !== credited)) throw new AppError("ATTRIBUTION_TOTAL_MISMATCH", 400);
    }
  }
  return data;
}

export async function readAdImportBody(request: Request): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw new AppError("JSON_REQUIRED", 415);
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_AD_IMPORT_BYTES)) throw new AppError("ADS_IMPORT_TOO_LARGE", 413);
  if (!request.body) throw new AppError("INVALID_AD_REPORT", 400);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > MAX_AD_IMPORT_BYTES) { await reader.cancel(); throw new AppError("ADS_IMPORT_TOO_LARGE", 413); } parts.push(value); }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(parts).toString("utf8")); }
  catch { throw new AppError("INVALID_AD_REPORT", 400); }
}
