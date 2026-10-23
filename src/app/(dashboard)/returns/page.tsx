import { ReportLink } from "@/components/report-link";
import { getDashboardData } from "@/server/dashboard";
import { Card, Badge, Status, EmptyState, PageHeading } from "@/components/ui";
import { rupiah, timeLabel } from "@/lib/format";
import { ReportChart } from "@/components/report-chart";
import { ReportingControls } from "@/components/reporting-controls";
import { pageReportPeriod, type ReportQuery } from "@/core/reporting-period";

export default async function Returns({ searchParams }: { searchParams: Promise<ReportQuery> }) {
  const period = pageReportPeriod(await searchParams);
  const data = await getDashboardData(period);
  return <>
    <PageHeading title="Returns"/>
    <div className="notice"><strong>Live return sync is not yet enabled.</strong><span>Stored cases may be incomplete. A return request does not reduce sales until its financial outcome is confirmed.</span></div>
    <ReportingControls period={period}/>
    <Card className="report-trend-card" role="region" aria-label="Refund chart"><div className="card-heading report-chart-heading"><div><h2>Recorded refunds over time</h2><p>By latest source return update, not cash settlement date / IDR</p></div></div><ReportChart data={data.trend} series={[{ key: "refunds", label: "Recorded refunds", color: "var(--chart-refund)" }]} label="Recorded refunds over time"/></Card>
    <Card><div className="card-heading"><div><h2>Return cases</h2><p>{data.mode === "demo" ? "Sample case" : "Stored cases; live coverage is not yet verified"}</p></div></div>{data.returns.length ? <div className="table-scroll" tabIndex={0}><table><thead><tr><th>Return / order</th><th>Status</th><th>Reported amount</th><th>Confirmed refund</th><th>Updated</th></tr></thead><tbody>{data.returns.map(value => <tr key={value.id}><td><strong>{value.returnSn}</strong><div className="subtext"><ReportLink href={`/orders/${encodeURIComponent(value.orderSn)}`}>{value.orderSn}</ReportLink></div></td><td><Status value={value.status}/></td><td>{rupiah(value.reportedAmount)}</td><td>{rupiah(value.confirmedRefund)}</td><td className="muted">{timeLabel(value.updatedAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No return updates in this period">Verified return cases will link to their original orders.</EmptyState>}</Card>
  </>;
}