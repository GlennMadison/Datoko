import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    <Card><div className="card-heading"><div><h2>Product costs</h2><p>Current costs; completed unit counts follow the selected period</p></div>{data.products.some(product => product.cost === null) && <Badge tone="orange">{data.products.filter(product => product.cost === null).length} missing costs</Badge>}</div>{data.products.length ? <div className="table-scroll" tabIndex={0}><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Units sold</TableHead><TableHead>Current unit cost</TableHead><TableHead>New cost / IDR</TableHead></TableRow></TableHeader><TableBody>{data.products.map(product => <TableRow key={product.id}><TableCell><strong>{product.name}</strong><div className="subtext">{product.sku}</div></TableCell><TableCell>{product.units}</TableCell><TableCell>{product.cost === null ? <Badge tone="orange">Cost missing</Badge> : rupiah(product.cost)}</TableCell><TableCell><CostForm variantId={product.id} name={product.name} disabled={data.mode === "demo"}/></TableCell></TableRow>)}</TableBody></Table></div> : <EmptyState title="No products in this period">Choose a different date range, or connect Shopee and sync your orders.</EmptyState>}</Card>
    <p className="page-note">New costs apply from the time you save them. Historical cost snapshots stay unchanged.{data.mode === "demo" && " Demo data is read-only."}</p>
  </>;
}