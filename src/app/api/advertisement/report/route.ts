import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { advertisementForOwner, getAdvertisementData, adReportFilters } from "@/server/ads";
import { isDemo } from "@/server/env";
import { resolveReportPeriod, type ReportQuery } from "@/core/reporting-period";
import { AppError } from "@/core/errors";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const actor = isDemo() ? null : await requireUser(request.headers);
    const query: ReportQuery = {};
    for (const key of request.nextUrl.searchParams.keys()) { const values = request.nextUrl.searchParams.getAll(key); if (values.length !== 1) throw new AppError("INVALID_REPORT_FILTER", 400); query[key] = values[0]; }
    const period = resolveReportPeriod(query);
    const filters = adReportFilters(query);
    const data = actor ? await advertisementForOwner(actor.ownerId, period, filters) : await getAdvertisementData(period, filters);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store, private", "Vary": "Cookie" } });
  } catch (error) { return errorResponse(error); }
}
