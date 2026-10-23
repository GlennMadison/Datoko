import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { getDashboardData } from "@/server/dashboard";
import { Button, Card, Badge, PageHeading } from "@/components/ui";
import { OrderTable } from "@/components/order-table";
import { ReportChart } from "@/components/report-chart";
import { ReportingControls, ReportHiddenFields } from "@/components/reporting-controls";
import { ReportLink } from "@/components/report-link";
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
  const filtered = Boolean(searchText || status);
  return <>
    <PageHeading title="Orders" actions={<Badge>{rows.length} orders</Badge>}/>
    <ReportingControls period={period}/>
    <form className="table-filters" aria-label="Order filters"><ReportHiddenFields query={query}/>
      <label>Search orders<Input name="q" aria-label="Search orders" placeholder="Order number, product, or SKU" maxLength={200} defaultValue={searchText}/></label>
      <label>Status<NativeSelect name="status" aria-label="Order status" defaultValue={status}><NativeSelectOption value="">All statuses</NativeSelectOption><NativeSelectOption value="COMPLETED">Completed</NativeSelectOption><NativeSelectOption value="READY_TO_SHIP">Ready to ship</NativeSelectOption><NativeSelectOption value="SHIPPED">Shipped</NativeSelectOption><NativeSelectOption value="CANCELLED">Cancelled</NativeSelectOption></NativeSelect></label>
      <Button variant="outline" type="submit">Filter</Button>{filtered && <Button asChild variant="outline"><ReportLink href="/orders">Clear filters</ReportLink></Button>}
    </form>
    <Card className="report-trend-card" role="region" aria-label="Order chart"><div className="card-heading report-chart-heading"><div><h2>Orders over time</h2><p>By order creation date{filtered ? "; current search and status filters applied" : ""}</p></div></div><ReportChart data={trend} series={[{ key: "orders", label: "Orders", color: "var(--chart-primary)" }]} unit="count" label="Orders over time"/></Card>
    <Card><div className="card-heading"><h2>{filtered ? "Matching orders" : "Order list"}</h2><span className="muted">{rows.length} results</span></div><OrderTable orders={rows} filtered={filtered} paginated/></Card>
    <p className="page-note">Order dates use WIB. Buyer totals may include shipping and differ from merchandise sales and advertising revenue.</p>
  </>;
}
