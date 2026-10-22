import { ReportLink as Link } from "./report-link";
import type { OrderRow } from "@/server/dashboard";
import { rupiah, dateLabel } from "@/lib/format";
import { Status, Badge, EmptyState } from "./ui";

export function OrderTable({ orders }: { orders: OrderRow[] }) {
  if (!orders.length) return <EmptyState title="Your orders will appear here">Connect your Shopee shop and run the first import.</EmptyState>;
  return <div className="table-scroll"><table><thead><tr><th>Order / product</th><th>Date</th><th>Status</th><th className="text-right">Order value</th><th/></tr></thead><tbody>{orders.map(order => <tr key={order.id}><td><Link href={`/orders/${encodeURIComponent(order.orderSn)}`} className="order-name">{order.name}</Link><div className="subtext">{order.orderSn} <span className="muted-dot">·</span> {order.quantity} item{order.quantity === 1 ? "" : "s"}{order.hasReturn && <> <Badge tone="orange">Return</Badge></>}</div></td><td className="muted">{dateLabel(order.createdAt)}</td><td><Status value={order.status}/></td><td className="text-right numeric strong">{rupiah(order.total)}</td><td>{order.costMissing && <span className="cost-flag" title="At least one item is missing a historical cost">Cost missing</span>}</td></tr>)}</tbody></table></div>;
}
