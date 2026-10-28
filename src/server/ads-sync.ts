import { AppError, publicErrorCode } from "../core/errors.ts";
import { adsRange, adsSyncDue, normalizeAdsMetrics, normalizeCampaignAds, type AdsRow } from "../core/shopee-ads.ts";
import { localDate, shiftDate } from "../core/reporting-period.ts";
import { getDb } from "./db.ts";
import { getConfig, isDemo, partnerConfig } from "./env.ts";
import { accessForShop, withShopLock } from "./connections.ts";
import { ShopeeClient } from "./shopee-client.ts";
import { importSyncedAdReport } from "./ads.ts";

type Controls = { shouldPause?: () => boolean };
export async function requestAdsSync(ownerId: string) {
  if (isDemo()) throw new AppError("DEMO_READ_ONLY", 409);
  const db = getDb();
  const shop = await db.shop.findFirst({ where: { ownerId, environment: getConfig().SHOPEE_ENV, connection: { status: "CONNECTED" } } });
  if (!shop) throw new AppError("SHOP_NOT_CONNECTED", 409);
  // The existing minute worker consumes this durable request if the tab closes.
  const previous = await db.syncState.findUnique({ where: { shopId_resource: { shopId: shop.id, resource: "ads-request" } } });
  if (previous && previous.updatedAt.getTime() > Date.now() - 60_000) return { queued: true };
  await db.syncState.upsert({ where: { shopId_resource: { shopId: shop.id, resource: "ads-request" } },
    create: { shopId: shop.id, resource: "ads-request", checkpoint: new Date() }, update: { checkpoint: new Date() } });
  return { queued: true };
}
export async function syncShopAds(shopId: string, generation: number, controls: Controls = {}) {
  return withShopLock(`ads-sync:${shopId}`, async () => {
    const db = getDb(), config = getConfig(), client = new ShopeeClient(partnerConfig());
    const shop = await db.shop.findFirst({ where: { id: shopId, environment: config.SHOPEE_ENV, connection: { version: generation, status: "CONNECTED" } }, include: { syncStates: true } });
    if (!shop || shop.currency !== "IDR") throw new AppError("CONNECTION_CHANGED", 409);
    const range = adsRange(), requestAt = shop.syncStates.find(s => s.resource === "ads-request")?.checkpoint ?? null;
    let imported = 0, unchanged = 0, completed = 0, failed = 0;
    const read = async <T>(action: (token: string, sourceId: string) => Promise<T>): Promise<T> => {
      if (controls.shouldPause?.()) throw new AppError("ADS_SYNC_PAUSED", 409);
      let access = await accessForShop(shopId, generation);
      try { return await action(access.accessToken, access.sourceShopId); }
      catch (error) {
        if (!(error instanceof AppError) || error.code !== "SHOPEE_ACCESS_EXPIRED") throw error;
        access = await accessForShop(shopId, generation, access.accessToken);
        return action(access.accessToken, access.sourceShopId);
      }
    };
    const save = async (reports: AdsRow[]) => {
      for (let offset = 0; offset < reports.length; offset += 200) {
        if (controls.shouldPause?.()) throw new AppError("ADS_SYNC_PAUSED", 409);
        const result = await importSyncedAdReport(shop, generation, reports.slice(offset, offset + 200), range.now);
        imported += result.imported; unchanged += result.unchanged;
      }
    };
    const mark = async (resource: string, code: string | null) => {
      await db.$transaction(async tx => {
        const connection = await tx.$queryRaw<{ version: number; status: string }[]>`SELECT version, status FROM shop_connections WHERE "shopId" = ${shopId} FOR SHARE`;
        if (connection[0]?.version !== generation || connection[0]?.status !== "CONNECTED") throw new AppError("CONNECTION_CHANGED", 409);
        const success = code ? {} : { lastSuccessAt: new Date(), checkpoint: range.now, coverageFrom: new Date(`${range.from}T00:00:00+07:00`) };
        await tx.syncState.upsert({ where: { shopId_resource: { shopId, resource } }, create: { shopId, resource, ...success, lastErrorCode: code }, update: { ...success, lastErrorCode: code, updatedAt: new Date() } });
      });
    };
    const attempt = async (resource: string, action: () => Promise<void>): Promise<boolean> => {
      const state = shop.syncStates.find(s => s.resource === resource);
      if (!adsSyncDue(state, requestAt, config.SYNC_INTERVAL_MINUTES, range.now)) return !state?.lastErrorCode;
      if (controls.shouldPause?.()) return false;
      try { await action(); await mark(resource, null); completed++; return true; }
      catch (error) {
        const code = publicErrorCode(error);
        if (code === "ADS_SYNC_PAUSED") return false;
        if (code === "CONNECTION_CHANGED") throw error;
        await mark(resource, code);
        console.error(JSON.stringify({ event: "ads_sync_failed", resource, code, errorType: error instanceof Error ? error.name : "unknown" }));
        failed++; return false;
      }
    };
    const dailyOk = await attempt("ads", async () => {
      const raw = await read((token, sourceId) => client.adsDaily(token, sourceId, range.from, range.to));
      await save(normalizeAdsMetrics(raw, "DAY", range));
    });
    // A denied permission must not fan out into requests to every ads endpoint.
    if (dailyOk) {
      await attempt("ads-hourly", async () => {
        for (const date of [range.to, shiftDate(range.to, -1)]) {
          const raw = await read((token, sourceId) => client.adsHourly(token, sourceId, date));
          await save(normalizeAdsMetrics(raw, "HOUR", { ...range, from: date, to: date }));
        }
      });
      await attempt("ads-campaigns", async () => {
        const ids: string[] = [], seen = new Set<string>();
        for (;;) {
          if (ids.length >= 5000) throw new AppError("ADS_CAMPAIGN_LIMIT", 502);
          const page = await read((token, sourceId) => client.adsCampaigns(token, sourceId, ids.length));
          for (const id of page.ids) {
            if (seen.has(id)) throw new AppError("REPEATED_ADS_CAMPAIGN", 502);
            seen.add(id); ids.push(id);
          }
          if (!page.more) break;
          if (!page.ids.length) throw new AppError("MISSING_ADS_CAMPAIGN_PAGE", 502);
        }
        for (let offset = 0; offset < ids.length; offset += 100) {
          const batch = ids.slice(offset, offset + 100);
          const raw = await read((token, sourceId) => client.adsCampaignDaily(token, sourceId, range.from, range.to, batch));
          let products = new Map<string, string[]>();
          try { products = await read((token, sourceId) => client.adsCampaignSettings(token, sourceId, batch)); }
          catch (error) {
            if (error instanceof AppError && ["CONNECTION_CHANGED", "ADS_SYNC_PAUSED"].includes(error.code)) throw error;
            console.error(JSON.stringify({ event: "ads_product_mapping_unavailable", code: publicErrorCode(error) }));
          }
          await save(normalizeCampaignAds(raw, shop.sourceShopId, batch, range, products));
        }
      });
    }
    return { imported, unchanged, completed, failed };
  });
}

/** Explicit historical request; one 30-day window per worker tick. */
export async function syncShopAdsHistory(shopId: string, generation: number, controls: Controls = {}) {
  return withShopLock(`ads-sync:${shopId}`, async () => {
    const db = getDb();
    const shop = await db.shop.findFirst({ where: { id: shopId, environment: getConfig().SHOPEE_ENV, connection: { version: generation, status: "CONNECTED" } } });
    if (!shop || shop.currency !== "IDR") throw new AppError("CONNECTION_CHANGED", 409);
    const state = await db.syncState.findUnique({ where: { shopId_resource: { shopId, resource: "ads-history" } } });
    const result = { imported: 0, unchanged: 0, completed: 0, failed: 0 };
    const target = adsRange().from;
    if (!state?.checkpoint || state.lastErrorCode || localDate(state.checkpoint) >= target || controls.shouldPause?.()) return result;
    const from = localDate(state.checkpoint);
    const to = [shiftDate(from, 29), shiftDate(target, -1)].sort()[0];
    const now = new Date();
    const client = new ShopeeClient(partnerConfig());
    const mark = async (data: { checkpoint?: Date; lastSuccessAt?: Date; lastErrorCode: string | null }) => {
      await db.$transaction(async tx => {
        const connection = await tx.$queryRaw<{ version: number; status: string }[]>`SELECT version, status FROM shop_connections WHERE "shopId" = ${shopId} FOR SHARE`;
        if (connection[0]?.version !== generation || connection[0]?.status !== "CONNECTED") throw new AppError("CONNECTION_CHANGED", 409);
        await tx.syncState.update({ where: { id: state.id }, data });
      });
    };
    try {
      let access = await accessForShop(shopId, generation);
      let raw: unknown[];
      try { raw = await client.adsDaily(access.accessToken, access.sourceShopId, from, to); }
      catch (error) {
        if (!(error instanceof AppError) || error.code !== "SHOPEE_ACCESS_EXPIRED") throw error;
        access = await accessForShop(shopId, generation, access.accessToken);
        raw = await client.adsDaily(access.accessToken, access.sourceShopId, from, to);
      }
      const reports = normalizeAdsMetrics(raw, "DAY", { from, to, now });
      // Persist only actual source rows. An empty response never means zero spend.
      if (reports.length) {
        const saved = await importSyncedAdReport(shop, generation, reports, now);
        result.imported = saved.imported; result.unchanged = saved.unchanged;
      }
      const dates = new Set(reports.map(row => localDate(new Date(row.start))));
      for (let date = from; date <= to; date = shiftDate(date, 1)) {
        if (!dates.has(date)) throw new AppError("ADS_HISTORY_INCOMPLETE", 502);
      }
      await mark({ checkpoint: new Date(`${shiftDate(to, 1)}T00:00:00+07:00`), lastSuccessAt: now, lastErrorCode: null });
      result.completed = 1;
    } catch (error) {
      const code = publicErrorCode(error);
      if (code === "CONNECTION_CHANGED") throw error;
      await mark({ lastErrorCode: code });
      console.error(JSON.stringify({ event: "ads_history_failed", code, from, to }));
      result.failed = 1;
    }
    return result;
  });
}

export async function syncDueAds(controls: Controls = {}) {
  const config = getConfig(), db = getDb();
  const shops = await db.shop.findMany({ where: { environment: config.SHOPEE_ENV, connection: { status: "CONNECTED" } }, include: { connection: true, syncStates: true } });
  const due = shops.filter(shop => {
    const main = shop.syncStates.find(s => s.resource === "ads");
    const requestAt = shop.syncStates.find(s => s.resource === "ads-request")?.checkpoint ?? null;
    if (adsSyncDue(main, requestAt, config.SYNC_INTERVAL_MINUTES)) return true;
    return !main?.lastErrorCode && ["ads-hourly", "ads-campaigns"].some(resource => adsSyncDue(shop.syncStates.find(s => s.resource === resource), requestAt, config.SYNC_INTERVAL_MINUTES));
  }).sort((a, b) => (a.syncStates.find(s => s.resource === "ads")?.updatedAt.getTime() ?? 0) - (b.syncStates.find(s => s.resource === "ads")?.updatedAt.getTime() ?? 0));
  const shop = due[0];
  const result = shop && !controls.shouldPause?.()
    ? await syncShopAds(shop.id, shop.connection!.version, controls)
    : { imported: 0, unchanged: 0, completed: 0, failed: 0 };
  const historyShop = shops.find(candidate => candidate.syncStates.some(state =>
    state.resource === "ads-history" && state.checkpoint && !state.lastErrorCode && localDate(state.checkpoint) < adsRange().from));
  if (historyShop && !controls.shouldPause?.()) {
    const history = await syncShopAdsHistory(historyShop.id, historyShop.connection!.version, controls);
    for (const key of ["imported", "unchanged", "completed", "failed"] as const) result[key] += history[key];
  }
  return result;
}
