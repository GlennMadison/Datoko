import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { AppError } from "@/core/errors";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const actor = await requireUser(request.headers);
    const { jobId } = await context.params;
    const run = await getDb().syncRun.findFirst({ where: { jobId, shop: { ownerId: actor.ownerId } }, select: { id: true, status: true, processed: true, errorCode: true, startedAt: true, finishedAt: true } });
    if (!run) throw new AppError("JOB_NOT_FOUND", 404);
    return NextResponse.json(run, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
