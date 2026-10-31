import { digest } from "../core/security.ts";
import { localDate } from "../core/reporting-period.ts";
import type { WorkspaceStatus } from "../core/workspace-refresh.ts";
import { getConfig } from "./env.ts";
import { getDb } from "./db.ts";
import { reportShop } from "./report-context.ts";

export async function workspaceStatus(ownerId: string): Promise<WorkspaceStatus> {
  const shop = await reportShop(ownerId, getConfig().SHOPEE_ENV);
  if (!shop) return { version: digest("no-shop:" + ownerId), active: false, connected: false };
  const runs = await getDb().syncRun.findMany({ where: { shopId: shop.id, status: { in: ["QUEUED", "RUNNING", "RETRYING"] } },
    select: { id: true, status: true, processed: true }, orderBy: { id: "asc" }, take: 20 });
  const requested = shop.syncStates.find(state => state.resource === "ads-request")?.checkpoint;
  const ads = shop.syncStates.find(state => state.resource === "ads");
  const active = runs.length > 0 || !!(requested && (!ads || requested > ads.updatedAt));
  return { version: digest(JSON.stringify([shop.reportVersion, runs, localDate(new Date())])), active,
    connected: shop.connection?.status === "CONNECTED" };
}
