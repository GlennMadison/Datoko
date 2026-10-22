import { getDashboardData } from "@/server/dashboard";
import { Card, Badge } from "@/components/ui";
import { OrderTable } from "@/components/order-table";
import { ReportChart } from "@/components/report-chart";
import { ReportingControls, ReportHiddenFields } from "@/components/reporting-controls";
import { pageReportPeriod, type ReportQuery } from "@/core/reporting-period";
import { activityTrend } from "@/server/reporting";

export default async function Orders({ searchParams }: { searchParams: Promise<ReportQuery> }) {
  const query = await searchParams;
  const period = pageReportPeriod(query);
  const data = await getDashboardData(period);
  const searchText = typeof query.q === "string" ? query.q.slice(0, 200) : "";
  const search = searchText.toLowerCase();
  const status = typeof query.status === "string" && ["COMPLETED", "CANCELLED", "READY_TO_SHIP", "SHIPPED"].includes(query.status) ? query.status : "";
  const rows = data.orders.filter(order => (!status || order.status === status) && `${order.orderSn} ${order.name} ${order.sku}`.toLowerCase().includes(search));
  const trend = activityTrend(period, rows);
  return <>
    <div className="page-heading"><div><p className="eyebrow">YOUR ORDER BOOK</p><h1>Every order. Full context.</h1><p className="page-description">Keep the sale, cancellation, and what happened after.</p></div><Badge>{rows.length} orders</Badge></div>
    <ReportingControls period={period}/>
    <Card className="report-trend-card" role="region" aria-label="Order chart"><div className="card-heading report-chart-heading"><div><h2>Orders over time</h2><p>Order creation date; search and status filters included</p></div></div><ReportChart data={trend} series={[{ key: "orders", label: "Orders", color: "#216e59" }]} unit="count" label="Orders over time"/></Card>
    <Card><div className="card-heading"><form className="table-filters"><ReportHiddenFields query={query}/><input name="q" aria-label="Search orders" placeholder="Search order number, product, or SKU" maxLength={200} defaultValue={searchText}/><select name="status" aria-label="Order status" defaultValue={status}><option value="">All statuses</option><option value="COMPLETED">Completed</option><option value="READY_TO_SHIP">Ready to ship</option><option value="SHIPPED">Shipped</option><option value="CANCELLED">Cancelled</option></select><button className="button button-outline" type="submit">Filter</button></form></div><OrderTable orders={rows}/></Card>
    <p className="page-note">Order creation dates use WIB. Buyer order totals are separate from merchandise sales and advertising revenue.</p>
  </>;
}