import { getDb } from "@/server/db";
import { getConfig, liveConfig } from "@/server/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const mode = getConfig().DATOKO_MODE;
    if (mode === "demo") return Response.json({ status: "ok", service: "datoko-web", mode, database: "not_used" }, { headers });

    liveConfig();
    // Probe an application table so readiness covers both connectivity and
    // the deployed schema, without returning any owner or shop records.
    await getDb().$queryRaw`SELECT 1 FROM public.users LIMIT 1`;
    return Response.json({ status: "ok", service: "datoko-web", mode, database: "connected" }, { headers });
  } catch {
    return Response.json({ status: "unavailable", service: "datoko-web", database: "unavailable" }, { status: 503, headers });
  }
}
