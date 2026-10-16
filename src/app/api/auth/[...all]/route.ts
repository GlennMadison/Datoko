import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
async function handle(request: Request) {
  try {
    const handlers = toNextJsHandler(getAuth());
    return await (request.method === "POST" ? handlers.POST(request) : handlers.GET(request));
  } catch (error) { return errorResponse(error); }
}
export { handle as GET, handle as POST };
