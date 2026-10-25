import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { getConfig } from "@/server/env";
import { requestAdsSync } from "@/server/ads-sync";
import { assertSameOrigin } from "@/core/security";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request.headers.get("origin"), getConfig().APP_BASE_URL);
    const actor = await requireUser(request.headers);
    return NextResponse.json(await requestAdsSync(actor.ownerId), { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
