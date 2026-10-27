import { requireUser } from "@/server/auth";
import { assertSameOrigin } from "@/core/security";
import { getConfig } from "@/server/env";
import { AppError } from "@/core/errors";
import { errorResponse } from "@/server/http";
import { setAutoProcessing } from "@/server/auto-process";
import { refreshCourierCatalog, setCourierRule, settingsInput } from "@/server/courier-settings";

export async function POST(request: Request, context: { params: Promise<{ shopId: string }> }) {
  try {
    assertSameOrigin(request.headers.get("origin"), getConfig().APP_BASE_URL);
    const actor = await requireUser(request.headers);
    const { shopId } = await context.params;
    if (Number(request.headers.get("content-length")) > 8192) throw new AppError("INVALID_SETTING");
    const parsed = settingsInput.safeParse(await request.json());
    if (!parsed.success) throw new AppError("INVALID_SETTING");
    const input = parsed.data;
    if ("action" in input) return Response.json(await refreshCourierCatalog(shopId, actor.ownerId), { headers: { "Cache-Control": "no-store" } });
    if ("rule" in input) {
      await setCourierRule(shopId, actor.ownerId, input.rule);
      return Response.json({ saved: true }, { headers: { "Cache-Control": "no-store" } });
    }
    const setting = await setAutoProcessing(shopId, actor.ownerId, input.enabled);
    return Response.json({ enabled: setting.enabled }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "auto_processing_setting_failed", code: error instanceof AppError ? error.code : "INTERNAL_ERROR" }));
    return errorResponse(error);
  }
}
