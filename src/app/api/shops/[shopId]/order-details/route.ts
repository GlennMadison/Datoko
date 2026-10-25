import { syncShopReturns } from "@/server/returns";
import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { getConfig, isDemo } from "@/server/env";
import { assertSameOrigin } from "@/core/security";
import { AppError } from "@/core/errors";
import { errorResponse } from "@/server/http";
import { syncVariationNames } from "@/server/variation-names";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request, context: { params: Promise<{ shopId: string }> }) {
  try {
    const config = getConfig();
    assertSameOrigin(request.headers.get("origin"), config.APP_BASE_URL);
    const actor = await requireUser(request.headers);
    if (isDemo()) throw new AppError("DEMO_READ_ONLY", 409);
    const { shopId } = await context.params;
    const shop = await getDb().shop.findFirst({ where: { id: shopId, ownerId: actor.ownerId, environment: config.SHOPEE_ENV }, include: { connection: true } });
    if (!shop || shop.connection?.status !== "CONNECTED") throw new AppError("SHOP_NOT_CONNECTED", 404);
    const deadline = Date.now() + 200_000;
    const details = await syncVariationNames(shop.id, shop.connection.version, { shouldPause: () => Date.now() >= deadline });
    const returns = await syncShopReturns(shop.id, shop.connection.version, { shouldPause: () => Date.now() >= deadline });
    return Response.json({ ...details, returns }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
