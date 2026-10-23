import { getDashboardData } from "@/server/dashboard";
import { Card, Badge, EmptyState, PageHeading } from "@/components/ui";
import { CostForm } from "@/components/cost-form";
import { rupiah } from "@/lib/format";
import { ReportChart } from "@/components/report-chart";
import { ReportingControls } from "@/components/reporting-controls";
import { pageReportPeriod, type ReportQuery } from "@/core/reporting-period";

export default async function Products({ searchParams }: { searchParams: Promise<ReportQuery> }) {
  const period = pageReportPeriod(await searchParams);
  const data = await getDashboardData(period);
  return <>
    <PageHeading title="Products & costs" description="Set a unit cost for each variant. Past orders keep their original cost."/>
    <ReportingControls period={period}/>
    <Card className="report-trend-card" role="region" aria-label="Product chart"><div className="card-heading report-chart-heading"><div><h2>Units sold over time</h2><p>Completed units by original order date in the selected period</p></div></div><ReportChart data={data.trend} series={[{ key: "units", label: "Completed units", color: "var(--chart-primary)" }]} unit="count" label="Product units over time"/></Card>
    <Card><div className="card-heading"><div><h2>Product costs</h2><p>Current costs; completed unit counts follow the selected period</p></div>{data.products.some(product => product.cost === null) && <Badge tone="orange">{data.products.filter(product => product.cost === null).length} missing costs</Badge>}</div>{data.products.length ? <div className="table-scroll" tabIndex={0}><table><thead><tr><th>Product</th><th>Units sold</th><th>Current unit cost</th><th>New cost / IDR</th></tr></thead><tbody>{data.products.map(product => <tr key={product.id}><td><strong>{product.name}</strong><div className="subtext">{product.sku}</div></td><td>{product.units}</td><td>{product.cost === null ? <Badge tone="orange">Cost missing</Badge> : rupiah(product.cost)}</td><td><CostForm variantId={product.id} name={product.name} disabled={data.mode === "demo"}/></td></tr>)}</tbody></table></div> : <EmptyState title="No products in this period">Choose a different date range, or connect Shopee and sync your orders.</EmptyState>}</Card>
    <p className="page-note">New costs apply from the time you save them. Historical cost snapshots stay unchanged.{data.mode === "demo" && " Demo data is read-only."}</p>
  </>;
}