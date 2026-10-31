import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { getOrderData } from "@/server/page-data";
import { orderPage } from "@/core/order-pagination";
import { Button, Card, Badge, PageHeading } from "@/components/ui";
import { OrderTable } from "@/components/order-table";
import { ReportChart } from "@/components/report-chart";
import { ReportingControls, ReportHiddenFields } from "@/components/reporting-controls";
import { ReportLink } from "@/components/report-link";
import { pageReportPeriod, type ReportQuery } from "@/core/reporting-period";

export default async function Orders({ searchParams }: { searchParams: Promise<ReportQuery> }) {
  const query = await searchParams;
  const period = pageReportPeriod(query);
  const data = await getOrderData(period, query);
  const { search: searchText, status } = orderPage(query);
  const rows = data.orders, trend = data.trend;
  const filtered = Boolean(searchText || status);
  return <>
    <PageHeading title="Orders" actions={<Badge>{data.total} orders</Badge>}/>
    <ReportingControls period={period}/>
    <form className="table-filters" aria-label="Order filters"><ReportHiddenFields query={query}/>
      <label>Search orders<Input name="q" aria-label="Search orders" placeholder="Order number, product, variation, or SKU" maxLength={200} defaultValue={searchText}/></label>
      <label>Status<NativeSelect name="status" aria-label="Order status" defaultValue={status}><NativeSelectOption value="">All statuses</NativeSelectOption><NativeSelectOption value="COMPLETED">Completed</NativeSelectOption><NativeSelectOption value="READY_TO_SHIP">Ready to ship</NativeSelectOption><NativeSelectOption value="SHIPPED">Shipped</NativeSelectOption><NativeSelectOption value="CANCELLED">Cancelled</NativeSelectOption></NativeSelect></label>
      <Button variant="outline" type="submit">Filter</Button>{filtered && <Button asChild variant="outline"><ReportLink href="/orders">Clear filters</ReportLink></Button>}
    </form>
    <Card className="report-trend-card" role="region" aria-label="Order chart"><div className="card-heading report-chart-heading"><div><h2>Orders over time</h2><p>By order creation date{filtered ? "; current search and status filters applied" : ""}</p></div></div><ReportChart data={trend} series={[{ key: "orders", label: "Orders", color: "var(--chart-primary)" }]} unit="count" label="Orders over time"/></Card>
    <Card><div className="card-heading"><h2>{filtered ? "Matching orders" : "Order list"}</h2><span className="muted">{data.total} results</span></div><OrderTable orders={rows} filtered={filtered} paginated serverPage={{ ...data.pagination, total: data.total }}/></Card>
    <p className="page-note">Order dates use WIB. Buyer totals may include shipping and differ from merchandise sales and advertising revenue.</p>
  </>;
}
