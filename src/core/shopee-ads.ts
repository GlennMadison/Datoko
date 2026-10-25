import { AppError } from "./errors.ts";
import { externalId } from "./shopee.ts";
import { amountString, amountUnits } from "./money.ts";
import { dayStart, localDate, shiftDate } from "./reporting-period.ts";
import type { AdImport } from "../server/ads-import-schema.ts";

export const SHOPEE_ADS_DATASET = "shopee-api-cpc-7d-total-v1";
export const ADS_HISTORY_DAYS = 30;
export type AdsRow = AdImport["reports"][number];
export type AdsRange = { from: string; to: string; now: Date };

export function adsDate(value: string): string {
  dayStart(value);
  return value.split("-").reverse().join("-");
}
function sourceDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{2}-\d{2}-\d{4}$/.test(value)) throw new AppError("INVALID_ADS_SOURCE_DATE", 502);
  const date = value.split("-").reverse().join("-");
  dayStart(date);
  return date;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("INVALID_ADS_SOURCE", 502);
  return value as Record<string, unknown>;
}
function money(value: unknown): string {
  // Never infer spend from rounded ROAS or replace missing fields with zero.
  if (typeof value !== "string" && typeof value !== "number") throw new AppError("INVALID_ADS_SOURCE_MONEY", 502);
  const text = String(value);
  if (!/^\d{1,16}(?:\.\d{1,4})?$/.test(text)) throw new AppError("INVALID_ADS_SOURCE_MONEY", 502);
  return amountString(amountUnits(text));
}
export function normalizeAdsMetrics(values: unknown[], grain: "DAY" | "HOUR", range: AdsRange, campaignKey = "shop", campaignName = "Shop total (CPC ads)"): AdsRow[] {
  const seen = new Set<string>();
  const reports: AdsRow[] = [];
  for (const value of values) {
    const row = object(value), date = sourceDate(row.date);
    if (date < range.from || date > range.to) throw new AppError("ADS_SOURCE_OUTSIDE_RANGE", 502);
    const hour = grain === "HOUR" ? row.hour : 0;
    if (typeof hour !== "number" || !Number.isInteger(hour) || hour < 0 || hour > 23) throw new AppError("INVALID_ADS_SOURCE_HOUR", 502);
    const start = new Date(dayStart(date).getTime() + hour * 3_600_000);
    const key = start.toISOString();
    if (seen.has(key)) throw new AppError("DUPLICATE_ADS_SOURCE_PERIOD", 502);
    seen.add(key);
    const spend = money(row.expense), revenue = money(row.broad_gmv);
    // Do not report the rest of today's empty hours as observed zero activity.
    if (start > range.now) {
      if (amountUnits(spend) || amountUnits(revenue)) throw new AppError("ADS_SOURCE_IN_FUTURE", 502);
      continue;
    }
    reports.push({ campaignKey, campaignName, grain, start: key, end: new Date(start.getTime() + (grain === "DAY" ? 86_400_000 : 3_600_000)).toISOString(),
      spend, revenue, sourceAsOf: range.now.toISOString(), attributionComplete: false, outcomesComplete: false, allocations: [] });
  }
  return reports;
}
export function normalizeCampaignAds(values: unknown[], shopId: string, campaignIds: string[], range: AdsRange): AdsRow[] {
  const requested = new Set(campaignIds), seen = new Set<string>();
  const reports: AdsRow[] = [];
  for (const value of values) {
    const shop = object(value);
    if (externalId(shop.shop_id) !== shopId || shop.region !== "ID" || !Array.isArray(shop.campaign_list)) throw new AppError("ADS_SOURCE_SHOP_MISMATCH", 502);
    for (const value of shop.campaign_list) {
      const campaign = object(value), id = externalId(campaign.campaign_id);
      if (!requested.has(id) || seen.has(id) || !Array.isArray(campaign.metrics_list)) throw new AppError("INVALID_ADS_SOURCE_CAMPAIGN", 502);
      seen.add(id);
      const name = typeof campaign.ad_name === "string" && campaign.ad_name.trim() ? campaign.ad_name.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 100) : `Campaign ${id}`;
      reports.push(...normalizeAdsMetrics(campaign.metrics_list, "DAY", range, `campaign:${id}`, name));
    }
  }
  if (seen.size !== requested.size) throw new AppError("INCOMPLETE_ADS_CAMPAIGNS", 502);
  return reports;
}
export function adsRange(now = new Date()): AdsRange {
  const today = localDate(now);
  return { from: shiftDate(today, 1 - ADS_HISTORY_DAYS), to: today, now };
}
export function adsSyncDue(state: { updatedAt: Date; lastSuccessAt: Date | null; lastErrorCode: string | null } | undefined, requestAt: Date | null, intervalMinutes: number, now = new Date()): boolean {
  if (!state || (requestAt && requestAt > state.updatedAt)) return true;
  const retryMs = state.lastErrorCode === "SHOPEE_PERMISSION_DENIED" ? 6 * 3_600_000 : intervalMinutes * 60_000;
  return now.getTime() - state.updatedAt.getTime() >= retryMs;
}
export function adsSyncIssue(code: string | null): string | null {
  if (!code) return null;
  if (code === "SHOPEE_PERMISSION_DENIED") return "Shopee denied Ads API access. Enable Ads permissions for this app in Shopee Open Platform, then sync again. Your order connection still works.";
  if (code === "SHOPEE_RATE_LIMIT") return "Shopee is limiting ads requests. Sync will retry automatically.";
  if (["CONNECTION_CHANGED", "SHOPEE_RECONNECT_REQUIRED", "SHOPEE_ACCESS_EXPIRED"].includes(code)) return "Reconnect your shop in Integrations to resume ads syncing.";
  if (code === "SHOPEE_ADS_WARNING") return "Shopee returned an incomplete ads report. Saved data is preserved; sync will retry.";
  return `Ads sync could not finish (${code}). Saved data is preserved; sync will retry.`;
}
