import { syncShopFinance } from "./finance.ts";
import { getDb } from "./db.ts";
import { getConfig, partnerConfig } from "./env.ts";
import { accessForShop, withShopLock } from "./connections.ts";
import { ShopeeClient } from "./shopee-client.ts";
import { normalizeOrder, type NormalizedOrder } from "../core/orders.ts";
import { AppError, publicErrorCode } from "../core/errors.ts";
import { syncWindows, importWindow, initialCoverageFrom, SyncWindowPaused } from "../core/sync.ts";
import type { SyncJob, SyncContinuation } from "./queue.ts";

async function saveOrder(shopId: string, generation: number, source: NormalizedOrder) {
  const db = getDb();
  await db.$transaction(async tx => {
    // A reconnect/disconnect must not commit between checking the generation
    // and writing an old job's data. The shared row lock fences those writes.
    const connection = await tx.$queryRaw<{ version: number; status: string }[]>`SELECT version, status FROM shop_connections WHERE "shopId" = ${shopId} FOR SHARE`;
    if (connection[0]?.version !== generation || connection[0]?.status !== "CONNECTED") throw new AppError("CONNECTION_CHANGED", 409);
    const previous = await tx.order.findUnique({ where: { shopId_orderSn: { shopId, orderSn: source.orderSn } } });
    if (previous && previous.sourceUpdatedAt > source.updatedAt) return;
    const data = { status: source.status, totalAmount: source.totalAmount, merchandiseAmount: source.merchandiseAmount, sourceUpdatedAt: source.updatedAt, lastSyncedAt: new Date() };
    const order = await tx.order.upsert({ where: { shopId_orderSn: { shopId, orderSn: source.orderSn } }, create: { shopId, orderSn: source.orderSn, currency: source.currency, sourceCreatedAt: source.createdAt, ...data }, update: data });
    if (!previous || previous.status !== source.status) await tx.orderHistory.create({ data: { orderId: order.id, previousStatus: previous?.status, status: source.status, sourceUpdatedAt: source.updatedAt } });
    for (const item of source.items) {
      const variant = await tx.productVariant.upsert({ where: { shopId_sourceItemId_sourceModelId: { shopId, sourceItemId: item.itemId, sourceModelId: item.modelId } }, create: { shopId, sourceItemId: item.itemId, sourceModelId: item.modelId, name: item.name, sku: item.sku }, update: { name: item.name, sku: item.sku } });
      const cost = await tx.skuCostVersion.findFirst({ where: { variantId: variant.id, effectiveAt: { lte: source.createdAt } }, orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }] });
      const existingItem = await tx.orderItem.findUnique({ where: { orderId_sourceLineKey: { orderId: order.id, sourceLineKey: item.lineKey } } });
      if (!existingItem) await tx.orderItem.create({ data: { orderId: order.id, sourceLineKey: item.lineKey, variantId: variant.id, name: item.name, sku: item.sku, quantity: item.quantity, originalUnitPrice: item.originalUnitPrice, paidUnitPrice: item.paidUnitPrice, costSnapshot: cost?.amount ?? null, costVersionId: cost?.id ?? null, costQuality: cost ? (cost.note?.startsWith("[Historical baseline]") ? "HISTORICAL_BASELINE" : "HISTORICAL_INPUT") : "MISSING" } });
      // Checkout and cost snapshots are intentionally immutable on replay.
    }
  });
}

export async function runShopSync(job: SyncJob, controls: { shouldPause?: () => boolean } = {}): Promise<SyncContinuation | undefined> {
  return withShopLock(`order-sync:${job.shopId}`, async () => {
    const db = getDb();
    const config = getConfig();
    const client = new ShopeeClient(partnerConfig());
    const run = await db.syncRun.findUniqueOrThrow({ where: { id: job.runId } });
    if (run.shopId !== job.shopId || run.generation !== job.generation) throw new AppError("INVALID_SYNC_JOB", 409);
    if (["SUCCEEDED", "CANCELLED"].includes(run.status)) return;
    await db.syncRun.update({ where: { id: job.runId }, data: { status: "RUNNING", startedAt: run.startedAt ?? new Date(), finishedAt: null, errorCode: null } });
    let processed = run.processed;
    try {
      const now = new Date();
      const coverageFrom = initialCoverageFrom(now, config.INITIAL_IMPORT_DAYS, config.SHOPEE_HISTORY_DAYS);
      const state = await db.syncState.upsert({ where: { shopId_resource: { shopId: job.shopId, resource: "orders" } }, create: { shopId: job.shopId, resource: "orders", coverageFrom }, update: {} });
      const windows = job.continuation
        ? job.continuation.windows.map(window => ({ from: new Date(window.from), to: new Date(window.to) })).filter(window => !state.checkpoint || window.to > state.checkpoint)
        : syncWindows({ checkpoint: state.checkpoint, coverageFrom: state.coverageFrom ?? coverageFrom, now, maxWindowDays: config.SHOPEE_MAX_WINDOW_DAYS, historyDays: config.SHOPEE_HISTORY_DAYS });
      const resume = job.continuation && windows[0]?.from.toISOString() === job.continuation.windows[0]?.from ? job.continuation.progress : undefined;
      if (resume) processed -= resume.count;
      const read = async <T>(action: (token: string, sourceShopId: string) => Promise<T>): Promise<T> => {
        const access = await accessForShop(job.shopId, job.generation);
        try { return await action(access.accessToken, access.sourceShopId); }
        catch (error) {
          if (!(error instanceof AppError) || error.code !== "SHOPEE_ACCESS_EXPIRED") throw error;
          const refreshed = await accessForShop(job.shopId, job.generation, access.accessToken);
          return action(refreshed.accessToken, refreshed.sourceShopId);
        }
      };
      for (const [index, window] of windows.entries()) {
        if (window.from.getTime() < now.getTime() - config.SHOPEE_HISTORY_DAYS * 86_400_000) throw new AppError("HISTORY_COVERAGE_GAP", 409);
        try {
          processed += await importWindow(window, { page: async (range, cursor) => {
            const page = await read((token, sourceId) => client.orderList(token, sourceId, range.from, range.to, cursor));
            const records: NormalizedOrder[] = [];
            for (let offset = 0; offset < page.orderSns.length; offset += 50) {
              const details = await read((token, sourceId) => client.orderDetails(token, sourceId, page.orderSns.slice(offset, offset + 50)));
              records.push(...details.map(normalizeOrder));
            }
            return { records, nextCursor: page.nextCursor };
          } }, {
            save: order => saveOrder(job.shopId, job.generation, order),
            commitCheckpoint: async through => {
              await db.$transaction(async tx => {
                const current = await tx.$queryRaw<{ version: number; status: string }[]>`SELECT version, status FROM shop_connections WHERE "shopId" = ${job.shopId} FOR SHARE`;
                if (current[0]?.version !== job.generation || current[0]?.status !== "CONNECTED") throw new AppError("CONNECTION_CHANGED", 409);
                await tx.syncState.update({ where: { id: state.id }, data: { checkpoint: through, lastSuccessAt: new Date(), lastErrorCode: null } });
              });
            },
          }, { resume: index === 0 ? resume : undefined, shouldPause: controls.shouldPause });
        } catch (error) {
          if (!(error instanceof SyncWindowPaused)) throw error;
          await db.syncRun.updateMany({ where: { id: job.runId, status: "RUNNING" }, data: { processed: processed + error.progress.count } });
          return { windows: windows.slice(index).map(range => ({ from: range.from.toISOString(), to: range.to.toISOString() })), progress: error.progress };
        }
        await db.syncRun.update({ where: { id: job.runId }, data: { processed } });
      }
      // Settlement refresh is independent: unavailable payment permissions must
      // not undo a successful order import. Each tick fills another bounded batch.
      if (!controls.shouldPause?.()) {
        try { await syncShopFinance(job.shopId, job.generation, { shouldPause: controls.shouldPause, limit: 25 }); }
        catch (error) { console.error(JSON.stringify({ event: "finance_sync_failed", code: publicErrorCode(error) })); }
      }
      const completed = await db.syncRun.updateMany({ where: { id: job.runId, status: "RUNNING", shop: { connection: { version: job.generation, status: "CONNECTED" } } }, data: { status: "SUCCEEDED", processed, finishedAt: new Date() } });
      if (!completed.count) await db.syncRun.updateMany({ where: { id: job.runId, status: "RUNNING" }, data: { status: "CANCELLED", errorCode: "CONNECTION_CHANGED", finishedAt: new Date() } });
    } catch (error) {
      const code = publicErrorCode(error);
      const cancelled = code === "CONNECTION_CHANGED";
      await db.syncRun.updateMany({ where: { id: job.runId, status: { not: "CANCELLED" } }, data: { status: cancelled ? "CANCELLED" : "RETRYING", errorCode: code, finishedAt: new Date() } });
      await db.syncState.updateMany({ where: { shopId: job.shopId, resource: "orders" }, data: { lastErrorCode: code } });
      if (!cancelled) throw new AppError(code, error instanceof AppError ? error.status : 500);
    }
  });
}
