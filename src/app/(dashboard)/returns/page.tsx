import { OrderDetailsSyncButton } from "@/components/order-details-sync-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportLink } from "@/components/report-link";
import { getReturnData } from "@/server/page-data";
import { Card, Badge, Status, EmptyState, PageHeading } from "@/components/ui";
import { rupiah, timeLabel } from "@/lib/format";
import { ReportChart } from "@/components/report-chart";
import { ReportingControls } from "@/components/reporting-controls";
import { pageReportPeriod, type ReportQuery } from "@/core/reporting-period";

export default async function Returns({ searchParams }: { searchParams: Promise<ReportQuery> }) {
  const period = pageReportPeriod(await searchParams);
  const data = await getReturnData(period);
  return <>
    <PageHeading title="Returns" actions={data.shop && <OrderDetailsSyncButton shopId={data.shop.id} label="Refresh returns" disabled={data.mode === "demo" || data.shop.status !== "CONNECTED"}/>}/>
    {!data.returnsReady && data.mode !== "demo" && <div className="notice"><strong>Return sync is pending.</strong><span>{data.returnsError === "SHOPEE_PERMISSION_DENIED" ? "Shopee has not granted return access to this app." : "Refresh returns to import the latest cases."}</span></div>}
    <p className="page-note">Return requests and accepted refunds are tracked separately. Net profit uses Shopee payouts, so refunds are not deducted twice.</p>
    <ReportingControls period={period}/>
    <Card className="report-trend-card" role="region" aria-label="Refund chart"><div className="card-heading report-chart-heading"><div><h2>Recorded refunds over time</h2><p>By latest source return update, not cash settlement date / IDR</p></div></div><ReportChart data={data.trend} series={[{ key: "refunds", label: "Recorded refunds", color: "var(--chart-refund)" }]} label="Recorded refunds over time"/></Card>
    <Card><div className="card-heading"><div><h2>Return cases</h2><p>{data.mode === "demo" ? "Sample case" : data.returnsReady ? "Synced from Shopee" : "Stored cases; sync pending"}</p></div></div>{data.returns.length ? <div className="table-scroll" tabIndex={0}><Table><TableHeader><TableRow><TableHead>Return / order</TableHead><TableHead>Status</TableHead><TableHead>Reported amount</TableHead><TableHead>Confirmed refund</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>{data.returns.map(value => <TableRow key={value.id}><TableCell><strong>{value.returnSn}</strong><div className="subtext"><ReportLink href={`/orders/${encodeURIComponent(value.orderSn)}`}>{value.orderSn}</ReportLink></div></TableCell><TableCell><Status value={value.status}/></TableCell><TableCell>{rupiah(value.reportedAmount)}</TableCell><TableCell>{rupiah(value.confirmedRefund)}</TableCell><TableCell className="muted">{timeLabel(value.updatedAt)}</TableCell></TableRow>)}</TableBody></Table></div> : <EmptyState title="No return updates in this period">Verified return cases will link to their original orders.</EmptyState>}</Card>
  </>;
}