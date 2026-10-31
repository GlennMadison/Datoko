import { requireUser } from "@/server/auth";
import { workspaceStatus } from "@/server/workspace-status";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await requireUser(request.headers);
    return Response.json(await workspaceStatus(actor.ownerId), { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch (error) { return errorResponse(error); }
}
