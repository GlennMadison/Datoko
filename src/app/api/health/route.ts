import { getDb } from "@/server/db";
import { getConfig, liveConfig } from "@/server/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function failureCode(error: unknown): string {
  const details: string[] = [];
  const inspect = (value: unknown, depth: number) => {
    if (typeof value === "string") details.push(value);
    else if (value && typeof value === "object" && depth < 5) {
      const record = value as Record<string, unknown>;
      for (const key of ["name", "message", "code", "cause", "meta", "driverAdapterError", "originalCode", "originalMessage"]) inspect(record[key], depth + 1);
    }
  };
  inspect(error, 0);
  const message = details.join(" ");
  // Return fixed categories only; driver messages can contain private details.
  if (/LOGIN_NOT_CONFIGURED|DATABASE_NOT_CONFIGURED|AUTH_SECRET_TOO_SHORT|HTTPS_REQUIRED/.test(message)) return "APP_CONFIGURATION";
  if (/unsupported.*startup|startup.*parameter/i.test(message)) return "DATABASE_STARTUP_PARAMETER";
  if (/tenant or user not found/i.test(message)) return "DATABASE_POOLER_TENANT";
  if (/password authentication|authentication failed|SCRAM|SASL/i.test(message)) return "DATABASE_AUTHENTICATION";
  if (/certificate|self.signed|SSL|TLS/i.test(message)) return "DATABASE_TLS";
  if (/permission denied|42501/i.test(message)) return "DATABASE_PERMISSION";
  if (/does not exist|42P01/i.test(message)) return "DATABASE_SCHEMA";
  if (/ENOTFOUND|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED|ETIMEDOUT|timeout|timed out|can't reach database/i.test(message)) return "DATABASE_NETWORK";
  return "DATABASE_QUERY_FAILED";
}

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
  } catch (error) {
    const code = failureCode(error);
    console.error(JSON.stringify({ event: "database_health_failed", code }));
    return Response.json({ status: "unavailable", service: "datoko-web", database: "unavailable", code }, { status: 503, headers });
  }
}
