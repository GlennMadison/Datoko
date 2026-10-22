import { NextResponse } from "next/server";
import { requireOwner } from "@/server/auth";
import { getDb } from "@/server/db";
import { getConfig } from "@/server/env";
import { dayStart, localDate, shiftDate } from "@/core/reporting-period";
import { AppError } from "@/core/errors";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await requireOwner(request.headers);
    const shop = await getDb().shop.findFirst({ where: { ownerId: actor.ownerId, environment: getConfig().SHOPEE_ENV } });
    if (!shop) throw new AppError("SHOP_NOT_FOUND", 404);
    const now = new Date(), today = localDate(now);
    return NextResponse.json({ version: 1, sourceShopId: shop.sourceShopId, environment: shop.environment, datasetKey: "shopee-report", datasetName: "Shopee ad report", basis: "PLACED_TOTAL", reports: [{ campaignKey: "shop", campaignName: "Shop report", grain: "DAY", start: dayStart(today).toISOString(), end: dayStart(shiftDate(today, 1)).toISOString(), spend: "0", revenue: "0", sourceAsOf: now.toISOString(), attributionComplete: false, outcomesComplete: false, allocations: [] }] }, { headers: { "Content-Disposition": 'attachment; filename="Datoko-ad-report-format.json"', "Cache-Control": "no-store, private" } });
  } catch (error) { return errorResponse(error); }
}
