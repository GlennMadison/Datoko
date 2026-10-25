import { getDb } from "./db.ts";
import { accessForShop, withShopLock } from "./connections.ts";
import { ShopeeClient } from "./shopee-client.ts";
import { getConfig, partnerConfig } from "./env.ts";
import { normalizeReturn, importReturnWindow } from "../core/returns.ts";
import { AppError, publicErrorCode } from "../core/errors.ts";
import { initialCoverageFrom, syncWindows } from "../core/sync.ts";

export async function syncShopReturns(shopId: string, generation: number, controls: { shouldPause?: () => boolean } = {}) {
  return withShopLock(`return-sync:${shopId}`, async () => {
    const db = getDb();
    const config = getConfig();
    const client = new ShopeeClient(partnerConfig());
    const now = new Date();
    const state = await db.syncState.upsert({ where: { shopId_resource: { shopId, resource: "returns" } }, create: { shopId, resource: "returns", coverageFrom: initialCoverageFrom(now, config.INITIAL_IMPORT_DAYS, config.SHOPEE_HISTORY_DAYS) }, update: {} });
    const read = async <T>(action: (token: string, sourceShopId: string) => Promise<T>): Promise<T> => {
      let access = await accessForShop(shopId, generation);
      try { return await action(access.accessToken, access.sourceShopId); }
      catch (error) {
        if (!(error instanceof AppError) || error.code !== "SHOPEE_ACCESS_EXPIRED") throw error;
        access = await accessForShop(shopId, generation, access.accessToken);
        return action(access.accessToken, access.sourceShopId);
      }
    };
    let processed = 0;
    try {
      const windows = syncWindows({ checkpoint: state.checkpoint, coverageFrom: state.coverageFrom!, now, maxWindowDays: 7, historyDays: config.SHOPEE_HISTORY_DAYS });
      for (const window of windows) {
        const result = await importReturnWindow({
          shouldPause: controls.shouldPause,
          page: offset => read((token, sourceId) => client.returnList(token, sourceId, window.from, window.to, offset)),
          save: async summary => {
            const returnSn = summary.return_sn as string;
            const raw = await read((token, sourceId) => client.returnDetail(token, sourceId, returnSn));
            const source = normalizeReturn(raw);
            if (source.returnSn !== returnSn) throw new AppError("RETURN_ID_MISMATCH", 502);
            await db.$transaction(async tx => {
              const connection = await tx.$queryRaw<{ version: number; status: string }[]>`SELECT version, status FROM shop_connections WHERE "shopId" = ${shopId} FOR SHARE`;
              if (connection[0]?.version !== generation || connection[0]?.status !== "CONNECTED") throw new AppError("CONNECTION_CHANGED", 409);
              const order = await tx.order.findUnique({ where: { shopId_orderSn: { shopId, orderSn: source.orderSn } } });
              if (!order) throw new AppError("RETURN_ORDER_NOT_IMPORTED", 409);
              const previous = await tx.returnCase.findUnique({ where: { shopId_returnSn: { shopId, returnSn } } });
              if (previous && previous.sourceUpdatedAt > source.updatedAt) return;
              const values = { status: source.status, reportedAmount: source.reportedAmount, confirmedRefund: source.confirmedRefund, sourceUpdatedAt: source.updatedAt, observedAt: new Date() };
              await tx.returnCase.upsert({ where: { shopId_returnSn: { shopId, returnSn } }, create: { shopId, orderId: order.id, returnSn, ...values }, update: values });
            });
          },
        });
        processed += result.processed;
        if (result.paused) return { processed, paused: true };
        await db.syncState.update({ where: { id: state.id }, data: { checkpoint: window.to } });
      }
      await db.syncState.update({ where: { id: state.id }, data: { lastSuccessAt: new Date(), lastErrorCode: null } });
      return { processed, paused: false };
    } catch (error) {
      await db.syncState.update({ where: { id: state.id }, data: { lastErrorCode: publicErrorCode(error) } });
      throw error;
    }
  });
}
