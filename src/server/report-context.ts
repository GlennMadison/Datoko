import { cache } from "react";
import { unstable_cache } from "next/cache";
import { digest } from "../core/security.ts";
import type { ReportPeriod } from "../core/reporting-period.ts";
import { getDb } from "./db.ts";

// Request-local only: authorization and connection state are never shared
// between requests. No encrypted credentials are selected for reporting.
export const reportShop = cache(async (ownerId: string, environment: string) => {
  const shop = await getDb().shop.findFirst({ where: { ownerId, environment }, select: {
    id: true, name: true, ownerId: true, environment: true, sourceShopId: true, updatedAt: true,
    connection: { select: { status: true, version: true, updatedAt: true } },
    syncStates: { select: { resource: true, checkpoint: true, coverageFrom: true, lastSuccessAt: true, lastErrorCode: true, updatedAt: true } },
  } });
  if (!shop) return null;
  const version = digest(JSON.stringify([shop.id, shop.updatedAt, shop.connection,
    [...shop.syncStates].sort((a, b) => a.resource.localeCompare(b.resource))]));
  return { ...shop, reportVersion: version };
});

export type ReportShop = NonNullable<Awaited<ReturnType<typeof reportShop>>>;

export function cachedReport<T>(shop: ReportShop, kind: string, period: ReportPeriod, filters: unknown, read: () => Promise<T>): Promise<T> {
  // effectiveToISO includes the current instant. Excluding it from the key lets
  // visits within a minute reuse one result; expiry bounds clock-based changes.
  // Sync checkpoints/connection changes select a new key, including old periods.
  const key = JSON.stringify(["reports-v1", kind, shop.ownerId, shop.environment, shop.id, shop.reportVersion,
    period.fromISO, period.toISO, period.interval, period.effectiveInterval, period.preset, period.today, period.label, period.error, filters]);
  return unstable_cache(async () => {
    const start = performance.now();
    const result = await read();
    if (process.env.DATABASE_USAGE_METRICS === "true") console.info(JSON.stringify({ event: "report_cache_miss", report: kind,
      durationMs: Math.round(performance.now() - start), resultBytes: Buffer.byteLength(JSON.stringify(result)) }));
    return result;
  }, [key], { revalidate: 60, tags: [reportCacheTag(shop.ownerId, shop.environment)] })();
}

export const reportCacheTag = (ownerId: string, environment: string) => "reports:" + digest(JSON.stringify([ownerId, environment]));

// Edits without a sync checkpoint (costs/manual ads) advance the same version.
export async function touchReportShop(shopId: string) {
  await getDb().shop.update({ where: { id: shopId }, data: { updatedAt: new Date() }, select: { id: true } });
}
