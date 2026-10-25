import { OrderDetailsSyncButton } from "@/components/order-details-sync-button";
import { getDashboardData } from "@/server/dashboard";
import { Card, Badge, EmptyState, PageHeading } from "@/components/ui";
import { ProductTable } from "@/components/product-table";
import { ReportChart } from "@/components/report-chart";
import { ReportingControls } from "@/components/reporting-controls";
import { pageReportPeriod, type ReportQuery } from "@/core/reporting-period";

export default async function Products({ searchParams }: { searchParams: Promise<ReportQuery> }) {
  const period = pageReportPeriod(await searchParams);
  const data = await getDashboardData(period);
  const missingCosts = data.products.reduce((sum, product) => sum + product.missingCosts, 0);
  return <>
    <PageHeading title="Products & costs" actions={data.shop && <OrderDetailsSyncButton shopId={data.shop.id} disabled={data.mode === "demo" || data.shop.status !== "CONNECTED"}/>} description="Set a unit cost for each variant. Past orders keep their original cost."/>
    <ReportingControls period={period}/>
    <Card className="report-trend-card" role="region" aria-label="Product chart"><div className="card-heading report-chart-heading"><div><h2>Units sold over time</h2><p>Completed units by original order date in the selected period</p></div></div><ReportChart data={data.trend} series={[{ key: "units", label: "Completed units", color: "var(--chart-primary)" }]} unit="count" label="Product units over time"/></Card>
    <Card><div className="card-heading"><div><h2>Product costs</h2><p>One row per product. Expand to manage variation costs.</p></div>{missingCosts > 0 && <Badge tone="orange">{missingCosts} missing costs</Badge>}</div>{data.products.length ? <ProductTable products={data.products} disabled={data.mode === "demo"}/> : <EmptyState title="No products yet">Connect Shopee and sync your orders.</EmptyState>}</Card>
    <p className="page-note">New costs apply from the time you save them. Historical cost snapshots stay unchanged.{data.mode === "demo" && " Demo data is read-only."}</p>
  </>;
}