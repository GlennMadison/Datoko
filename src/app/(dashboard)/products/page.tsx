import { getDashboardData } from "@/server/dashboard";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { rupiah } from "@/lib/format";
import { ReportChart } from "@/components/report-chart";
import { ReportingControls } from "@/components/reporting-controls";
import { pageReportPeriod, type ReportQuery } from "@/core/reporting-period";

export default async function Products({ searchParams }: { searchParams: Promise<ReportQuery> }) {
  const period = pageReportPeriod(await searchParams);
  const data = await getDashboardData(period);
  return <>
    <div className="page-heading"><div><p className="eyebrow">KNOW YOUR COSTS</p><h1>Better inputs. Clearer margins.</h1><p className="page-description">Set a cost for each variant. Your past orders keep their original cost snapshots.</p></div></div>
    <ReportingControls period={period}/>
    <Card className="report-trend-card" role="region" aria-label="Product chart"><div className="card-heading report-chart-heading"><div><h2>Units sold over time</h2><p>Completed units by original order date in the selected period</p></div></div><ReportChart data={data.trend} series={[{ key: "units", label: "Completed units", color: "#216e59" }]} unit="count" label="Product units over time"/></Card>
    <Card><div className="card-heading"><div><h2>Product costs</h2><p>Current costs; completed unit counts follow the selected period</p></div><Badge tone="orange">{data.products.filter(product => product.cost === null).length} missing costs</Badge></div>{data.products.length ? <div className="table-scroll"><table><thead><tr><th>Product</th><th>Units sold</th><th>Current unit cost</th><th>New cost / IDR</th></tr></thead><tbody>{data.products.map(product => <tr key={product.id}><td><strong>{product.name}</strong><div className="subtext">{product.sku}</div></td><td>{product.units}</td><td>{product.cost === null ? <Badge tone="orange">Cost missing</Badge> : rupiah(product.cost)}</td><td><form className="cost-form" action={`/api/variants/${encodeURIComponent(product.id)}/costs`} method="post"><input name="amount" type="number" min="0" step="0.0001" required placeholder="e.g. 46000" aria-label={`New cost for ${product.name}`} disabled={data.mode === "demo"}/><input type="hidden" name="note" value="Updated from product costs"/><Button disabled={data.mode === "demo"}>Save cost</Button></form></td></tr>)}</tbody></table></div> : <EmptyState title="Your catalog starts with an order">Connect Shopee to discover your product variants.</EmptyState>}</Card>
    <p className="page-note">New costs take effect now. They do not rewrite imported historical costs. Demo data is read-only.</p>
  </>;
}