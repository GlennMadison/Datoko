import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { beginConnection, authCookieName } from "@/server/connections";
import { assertSameOrigin } from "@/core/security";
import { getConfig } from "@/server/env";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const config = getConfig();
    assertSameOrigin(request.headers.get("origin"), config.APP_BASE_URL);
    const actor = await requireUser(request.headers);
    const form = await request.formData();
    const result = await beginConnection(actor, String(form.get("shopId") ?? ""), form.get("returnTo"));
    const response = NextResponse.redirect(result.url, 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set(authCookieName(), result.cookie, { httpOnly: true, secure: config.APP_BASE_URL.startsWith("https:"), sameSite: "lax", path: "/", maxAge: 600 });
    return response;
  } catch (error) { return errorResponse(error); }
}
