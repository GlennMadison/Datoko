import { NextResponse } from "next/server";
import { AppError, publicErrorCode } from "../core/errors.ts";

export function errorResponse(error: unknown): NextResponse {
  const code = publicErrorCode(error);
  return NextResponse.json({ error: code }, { status: error instanceof AppError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
}
