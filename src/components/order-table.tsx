import { ReportLink as Link } from "./report-link";
import type { OrderRow } from "@/server/dashboard";
import { rupiah, dateLabel } from "@/lib/format";
import { Status, Badge, EmptyState } from "./ui";

export function OrderTable({ orders, filtered = false }: { orders: OrderRow[]; filtered?: boolean }) {
  if (!orders.length) return <EmptyState title={filtered ? "No matching orders" : "No orders in this period"}>{filtered ? "Try another search or clear the filters." : "Choose a different date range, or connect a shop and sync its orders."}</EmptyState>;
  return <div className="table-scroll" tabIndex={0} role="region" aria-label="Orders"><table><thead><tr><th>Order / product</th><th>Date</th><th>Status</th><th className="text-right">Order value</th></tr></thead><tbody>{orders.map(order => <tr key={order.id}><td><Link href={`/orders/${encodeURIComponent(order.orderSn)}`} className="order-name">{order.name}</Link>{order.costMissing && <div className="cost-flag" title="At least one item is missing a historical cost">Cost missing</div>}<div className="subtext">{order.orderSn} <span className="muted-dot">·</span> {order.quantity} item{order.quantity === 1 ? "" : "s"}{order.hasReturn && <> <Badge tone="orange">Return</Badge></>}</div></td><td className="muted">{dateLabel(order.createdAt)}</td><td><Status value={order.status}/></td><td className="text-right numeric strong">{rupiah(order.total)}</td></tr>)}</tbody></table></div>;
}
