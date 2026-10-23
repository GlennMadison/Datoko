import { validWorkerAuthorization } from "@/core/worker-auth";
import { AppError, publicErrorCode } from "@/core/errors";
import { runSyncBatch } from "@/server/sync-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!validWorkerAuthorization(request.headers.get("authorization"), process.env.SYNC_WORKER_SECRET)) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
  try {
    const result = await runSyncBatch();
    console.log(JSON.stringify({ event: "sync_worker_tick", ...result }));
    return Response.json({ status: "ok", ...result }, { headers });
  } catch (error) {
    const code = publicErrorCode(error);
    if (error instanceof AppError && code === "SHOP_JOB_BUSY") return Response.json({ status: "busy" }, { status: 202, headers });
    console.error(JSON.stringify({ event: "sync_worker_failed", code }));
    return Response.json({ error: code }, { status: 503, headers });
  }
}
