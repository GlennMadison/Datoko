import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/server/auth";
import { authCookieName, finishConnection } from "@/server/connections";
import { getDb } from "@/server/db";
import { getConfig } from "@/server/env";
import { callbackParameters } from "@/core/authorization";
import { AppError, publicErrorCode } from "@/core/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const config = getConfig();
  const target = new URL("/settings/integrations", config.APP_BASE_URL);
  let processing = false;
  try {
    const actor = await requireOwner(request.headers);
    const params = callbackParameters(request.nextUrl.searchParams);
    const cookie = request.cookies.get(authCookieName())?.value;
    const [attemptId, browserSecret, extra] = cookie?.split(".") ?? [];
    if (!attemptId || !browserSecret || extra) throw new AppError("INVALID_CALLBACK_STATE");
    const attempt = await getDb().authAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw new AppError("AUTH_ATTEMPT_NOT_FOUND");
    const result = await finishConnection(attempt, { ...actor, ...params, browserSecret, environment: config.SHOPEE_ENV, now: new Date() });
    target.pathname = attempt.returnPath === "/overview" ? "/overview" : "/settings/integrations";
    target.searchParams.set("connection", result);
    processing = result === "processing";
  } catch (error) {
    const code = publicErrorCode(error);
    if (code === "SIGN_IN_REQUIRED") target.pathname = "/login";
    target.searchParams.set("connection", "failed");
    // Only an application-owned error code is retained; no source code/token/query.
    target.searchParams.set("reason", code);
  }
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  // A duplicate callback can see an in-flight exchange; preserve its binding.
  if (!processing) response.cookies.set(authCookieName(), "", { httpOnly: true, secure: config.APP_BASE_URL.startsWith("https:"), sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
