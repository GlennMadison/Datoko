import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/server/auth";
import { getConfig } from "@/server/env";
import { getDb } from "@/server/db";
import { REPORT_KEYS, resolveReportPeriod, type ReportQuery } from "@/core/reporting-period";
import { amountString, amountUnits } from "@/core/money";
import { AppError } from "@/core/errors";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const actor = await requireOwner(request.headers);
    const query: ReportQuery = {};
    for (const key of REPORT_KEYS) {
      const values = request.nextUrl.searchParams.getAll(key);
      if (values.length > 1) throw new AppError("INVALID_REPORT_FILTER", 400);
      if (values.length) query[key] = values[0];
    }
    const period = resolveReportPeriod(query), db = getDb();
    const shop = await db.shop.findFirst({ where: { ownerId: actor.ownerId, environment: getConfig().SHOPEE_ENV } });
    if (!shop) throw new AppError("SHOP_NOT_FOUND", 404);
    const where = { order: { shopId: shop.id, sourceCreatedAt: { gte: new Date(period.fromISO), lt: new Date(period.effectiveToISO) } } };
    if (await db.orderItem.count({ where }) > 10_000) throw new AppError("REPORT_RANGE_TOO_LARGE", 400);
    const items = await db.orderItem.findMany({ where, include: { order: { include: { returns: true } } }, orderBy: [{ orderId: "asc" }, { sourceLineKey: "asc" }] });
    return NextResponse.json({ sourceShopId: shop.sourceShopId, environment: shop.environment, from: period.from, to: period.to, timezone: "Asia/Jakarta",
      note: "Order references only. These records do not establish advertising attribution. Use the source ad report to assign credits and outcomes.",
      items: items.map(item => ({ orderSn: item.order.orderSn, lineKey: item.sourceLineKey, name: item.name, sku: item.sku, quantity: item.quantity,
        merchandiseValue: amountString(amountUnits(item.paidUnitPrice.toString()) * BigInt(item.quantity)), status: item.order.status, updatedAt: item.order.sourceUpdatedAt.toISOString(),
        returns: item.order.returns.map(value => ({ reference: value.returnSn, status: value.status, confirmedRefund: value.confirmedRefund?.toString() ?? null, updatedAt: value.sourceUpdatedAt.toISOString() })),
      })),
    }, { headers: { "Content-Disposition": 'attachment; filename="Datoko-order-item-references.json"', "Cache-Control": "no-store, private", "Vary": "Cookie" } });
  } catch (error) { return errorResponse(error); }
}
