import { NextResponse } from "next/server";
import { requireOwner } from "@/server/auth";
import { getDb } from "@/server/db";
import { getQueue, enqueueSync } from "@/server/queue";
import { assertSameOrigin } from "@/core/security";
import { getConfig } from "@/server/env";
import { AppError } from "@/core/errors";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ shopId: string }> }) {
  try {
    assertSameOrigin(request.headers.get("origin"), getConfig().APP_BASE_URL);
    const actor = await requireOwner(request.headers);
    const { shopId } = await context.params;
    const db = getDb();
    const shop = await db.shop.findFirst({ where: { id: shopId, ownerId: actor.ownerId, environment: getConfig().SHOPEE_ENV }, include: { connection: true } });
    if (!shop) throw new AppError("SHOP_NOT_FOUND", 404);
    if (shop.connection?.status !== "CONNECTED") throw new AppError("SHOPEE_RECONNECT_REQUIRED", 409);
    const boss = await getQueue();
    const result = await db.$transaction(tx => enqueueSync(tx, boss, { shopId, generation: shop.connection!.version, reason: "MANUAL" }));
    return NextResponse.json(result, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
