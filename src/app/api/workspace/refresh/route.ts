import { revalidateTag } from "next/cache";
import { requireUser } from "@/server/auth";
import { assertSameOrigin } from "@/core/security";
import { getConfig, isDemo } from "@/server/env";
import { AppError } from "@/core/errors";
import { errorResponse } from "@/server/http";
import { reportCacheTag } from "@/server/report-context";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const config = getConfig();
    assertSameOrigin(request.headers.get("origin"), config.APP_BASE_URL);
    if (isDemo()) throw new AppError("DEMO_READ_ONLY", 409);
    const actor = await requireUser(request.headers);
    revalidateTag(reportCacheTag(actor.ownerId, config.SHOPEE_ENV), { expire: 0 });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
