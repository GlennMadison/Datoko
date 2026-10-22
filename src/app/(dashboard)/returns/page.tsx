import { ReportLink } from "@/components/report-link";
import { getDashboardData } from "@/server/dashboard";
import { Card, Badge, Status, EmptyState } from "@/components/ui";
import { rupiah, timeLabel } from "@/lib/format";
import { ReportChart } from "@/components/report-chart";
import { ReportingControls } from "@/components/reporting-controls";
import { pageReportPeriod, type ReportQuery } from "@/core/reporting-period";

export default async function Returns({ searchParams }: { searchParams: Promise<ReportQuery> }) {
  const period = pageReportPeriod(await searchParams);
  const data = await getDashboardData(period);
  return <>
    <div className="page-heading"><div><p className="eyebrow">AFTER THE SALE</p><h1>Returns stay part of the story.</h1><p className="page-description">Track a return separately from its order and financial outcome.</p></div><Badge tone="orange">Live sync awaiting validation</Badge></div>
    <div className="notice"><strong>Reported amounts and confirmed refunds are separate.</strong><span>Live return ingestion is not enabled until your app&apos;s return fields and permissions are verified. A request alone never reduces recorded sales.</span></div>
    <ReportingControls period={period}/>
    <Card className="report-trend-card" role="region" aria-label="Refund chart"><div className="card-heading report-chart-heading"><div><h2>Recorded refunds over time</h2><p>By latest source return update, not cash settlement date / IDR</p></div></div><ReportChart data={data.trend} series={[{ key: "refunds", label: "Recorded refunds", color: "#b65a3b" }]} label="Recorded refunds over time"/></Card>
    <Card><div className="card-heading"><div><h2>Return cases</h2><p>{data.mode === "demo" ? "Illustrative sample case" : "Stored cases; complete live return coverage is not verified"}</p></div></div>{data.returns.length ? <div className="table-scroll"><table><thead><tr><th>Return / order</th><th>Status</th><th>Reported amount</th><th>Confirmed refund</th><th>Updated</th></tr></thead><tbody>{data.returns.map(value => <tr key={value.id}><td><strong>{value.returnSn}</strong><div className="subtext"><ReportLink href={`/orders/${encodeURIComponent(value.orderSn)}`}>{value.orderSn}</ReportLink></div></td><td><Status value={value.status}/></td><td>{rupiah(value.reportedAmount)}</td><td>{rupiah(value.confirmedRefund)}</td><td className="muted">{timeLabel(value.updatedAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No return updates in this period">Verified return cases will link to their original orders.</EmptyState>}</Card>
  </>;
}