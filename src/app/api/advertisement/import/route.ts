import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { getConfig } from "@/server/env";
import { importAdReport } from "@/server/ads";
import { readAdImportBody } from "@/server/ads-import-schema";
import { assertSameOrigin } from "@/core/security";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request.headers.get("origin"), getConfig().APP_BASE_URL);
    const actor = await requireUser(request.headers);
    const result = await importAdReport(actor.ownerId, await readAdImportBody(request));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
