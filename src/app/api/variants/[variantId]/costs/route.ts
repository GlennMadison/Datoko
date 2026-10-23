import { z } from "zod";
import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { assertSameOrigin } from "@/core/security";
import { amountUnits } from "@/core/money";
import { getConfig } from "@/server/env";
import { AppError } from "@/core/errors";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ variantId: string }> }) {
  try {
    const config = getConfig();
    assertSameOrigin(request.headers.get("origin"), config.APP_BASE_URL);
    const actor = await requireUser(request.headers);
    const { variantId } = await context.params;
    const form = await request.formData();
    const input = z.object({ amount: z.string().regex(/^\d{1,16}(?:\.\d{1,4})?$/), note: z.string().max(500) }).parse({ amount: form.get("amount"), note: form.get("note") ?? "" });
    if (amountUnits(input.amount) < 0n) throw new AppError("INVALID_COST");
    const db = getDb();
    const variant = await db.productVariant.findFirst({ where: { id: variantId, shop: { ownerId: actor.ownerId } } });
    if (!variant) throw new AppError("VARIANT_NOT_FOUND", 404);
    await db.skuCostVersion.create({ data: { variantId, amount: input.amount, effectiveAt: new Date(), createdBy: actor.ownerId, note: input.note || null } });
    return NextResponse.redirect(new URL("/products?saved=true", config.APP_BASE_URL), 303);
  } catch (error) { return errorResponse(error); }
}
