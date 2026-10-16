import { NextResponse } from "next/server";
import { requireOwner } from "@/server/auth";
import { disconnectShop } from "@/server/connections";
import { assertSameOrigin } from "@/core/security";
import { getConfig } from "@/server/env";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const config = getConfig();
    assertSameOrigin(request.headers.get("origin"), config.APP_BASE_URL);
    const actor = await requireOwner(request.headers);
    const form = await request.formData();
    await disconnectShop(String(form.get("shopId") ?? ""), actor.ownerId);
    return NextResponse.redirect(new URL("/settings/integrations?connection=disconnected", config.APP_BASE_URL), 303);
  } catch (error) { return errorResponse(error); }
}
