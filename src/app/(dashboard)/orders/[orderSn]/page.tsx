import { OrderProfitCard } from "@/components/order-profit-card";
import { calculateOrderProfit, readSettlement } from "@/core/profit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportLink as Link } from "@/components/report-link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isDemo, getConfig } from "@/server/env";
import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { getDashboardData } from "@/server/dashboard";
import { Card, Status, Badge } from "@/components/ui";
import { rupiah, dateLabel, timeLabel } from "@/lib/format";

export default async function OrderDetail({ params }: { params: Promise<{ orderSn: string }> }) {
  const { orderSn } = await params;
  if (isDemo()) {
    const data = await getDashboardData();
    const order = data.orders.find(value => value.orderSn === orderSn);
    if (!order) notFound();
    return <><Link href="/orders" className="back-link">&larr; Back to orders</Link><div className="page-heading"><div><h1>{order.orderSn}</h1><p className="page-description">Placed {dateLabel(order.createdAt)} · illustrative sample</p></div><Status value={order.status}/></div><div className="detail-grid"><Card><div className="card-heading"><h2>Purchased items</h2><Badge>Sample data</Badge></div><div className="table-scroll" tabIndex={0}><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Quantity</TableHead><TableHead>Order value</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>{order.name}{order.variationName && <div className="subtext">{order.variationName}</div>}<div className="subtext">{order.sku}</div></TableCell><TableCell>{order.quantity}</TableCell><TableCell>{rupiah(order.total)}</TableCell></TableRow></TableBody></Table></div></Card><Card className="detail-summary"><h2>Financial data</h2><p className="page-note">Order status, returns, and financial movements are tracked separately. Live financial calculations are awaiting API validation.</p></Card></div></>;
  }
  const actor = await requireUser(await headers());
  const order = await getDb().order.findFirst({ where: { orderSn, shop: { ownerId: actor.ownerId, environment: getConfig().SHOPEE_ENV } }, include: { financialSnapshots: { where: { source: "SHOPEE_ESCROW" }, orderBy: { revision: "desc" }, take: 1 }, items: true, history: { orderBy: { observedAt: "desc" } }, returns: true, financialEntries: { orderBy: { effectiveAt: "desc" } } } });
  if (!order) notFound();
  const settlement = readSettlement(order.financialSnapshots[0]?.amounts);
  const profit = calculateOrderProfit({ status: order.status, items: order.items.map(item => ({ quantity: item.quantity, costSnapshot: item.costSnapshot?.toString() ?? null, costQuality: item.costQuality })) }, settlement);
  return <><Link href="/orders" className="back-link">&larr; Back to orders</Link><div className="page-heading"><div><h1>{order.orderSn}</h1><p className="page-description">Placed {dateLabel(order.sourceCreatedAt)} · last observed {timeLabel(order.lastSyncedAt)}</p></div><Status value={order.status}/></div><div className="detail-grid"><div><Card><div className="card-heading"><h2>Purchased items</h2></div><div className="table-scroll" tabIndex={0}><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead>Paid unit price</TableHead><TableHead>Cost at sale</TableHead></TableRow></TableHeader><TableBody>{order.items.map(item => <TableRow key={item.id}><TableCell>{item.name}{item.variationName && <div className="subtext">{item.variationName}</div>}<div className="subtext">{item.sku ?? "No SKU"}</div></TableCell><TableCell>{item.quantity}</TableCell><TableCell>{rupiah(Number(item.paidUnitPrice))}</TableCell><TableCell>{item.costSnapshot === null ? <Badge tone="orange">Cost missing</Badge> : rupiah(Number(item.costSnapshot))}</TableCell></TableRow>)}</TableBody></Table></div></Card><Card style={{ marginTop: 22 }}><div className="card-heading"><h2>Observed status history</h2></div><div className="detail-timeline">{order.history.map(event => <div key={event.id}><Status value={event.status}/><p>Observed {timeLabel(event.observedAt)} · source updated {timeLabel(event.sourceUpdatedAt)}</p></div>)}</div></Card></div><OrderProfitCard shopId={order.shopId} orderSn={order.orderSn} merchandise={order.merchandiseAmount.toString()} result={profit} settlement={settlement} observedAt={order.financialSnapshots[0]?.observedAt ?? null}/></div></>;
}
