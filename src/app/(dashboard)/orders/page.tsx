import { getDashboardData } from "@/server/dashboard";
import { Card, Badge } from "@/components/ui";
import { OrderTable } from "@/components/order-table";

export default async function Orders({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const data = await getDashboardData(90);
  const search = (query.q ?? "").toLowerCase();
  const status = ["COMPLETED", "CANCELLED", "READY_TO_SHIP", "SHIPPED"].includes(query.status ?? "") ? query.status : "";
  const rows = data.orders.filter(order => (!status || order.status === status) && `${order.orderSn} ${order.name} ${order.sku}`.toLowerCase().includes(search));
  return <><div className="page-heading"><div><p className="eyebrow">YOUR ORDER BOOK</p><h1>Every order. Full context.</h1><p className="page-description">Keep the sale, cancellation, and what happened after.</p></div><Badge>{rows.length} orders</Badge></div><Card><div className="card-heading"><form className="table-filters"><input name="q" aria-label="Search orders" placeholder="Search order number, product, or SKU" defaultValue={query.q}/><select name="status" aria-label="Order status" defaultValue={status}><option value="">All statuses</option><option value="COMPLETED">Completed</option><option value="READY_TO_SHIP">Ready to ship</option><option value="SHIPPED">Shipped</option><option value="CANCELLED">Cancelled</option></select><button className="button button-outline" type="submit">Filter</button></form></div><OrderTable orders={rows}/></Card><p className="page-note">Order-date view · latest 90 days of imported records. Order value includes the buyer&apos;s total; it is separate from merchandise sales.</p></>;
}
