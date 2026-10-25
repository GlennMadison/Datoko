import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAdvertisementData, adReportFilters, type AdvertisementData } from "@/server/ads";
import { AppError } from "@/core/errors";
import { pageReportPeriod, type ReportQuery } from "@/core/reporting-period";
import { ReportingControls } from "@/components/reporting-controls";
import { AdvertisementFilters, AdvertisementImport } from "@/components/advertisement-controls";
import { ReportChart } from "@/components/report-chart";
import { ReportLink } from "@/components/report-link";
import { Card, Badge, EmptyState, PageHeading, Metric } from "@/components/ui";
import { adsMoney, adsRatio } from "@/lib/ads-format";
import { timeLabel } from "@/lib/format";
import { AdsSyncControls } from "@/components/ads-sync-controls";
import { adsSyncIssue, SHOPEE_ADS_DATASET } from "@/core/shopee-ads";

const estimateNotes: Record<string, string> = {
  ORDER_SYNC_INCOMPLETE: "Orders have not fully synced for this range. Sync your shop in Integrations.",
  RETURN_SYNC_INCOMPLETE: "Return history has not fully synced for this range. Sync your shop in Integrations.",
  OUTCOME_SYNC_STALE: "Order or return data is over 30 minutes old (or two sync intervals). The estimate resumes after a successful sync.",
  PAYMENT_OUTCOME_UNKNOWN: "Payment status is unknown for some sales. These need refreshed order details.",
  REFUND_AMOUNT_UNKNOWN: "A confirmed return has no verified refund amount. Its value is not assumed to be zero.",
  NO_ORDER_COHORT: "Ad revenue has no matching merchandise cohort on one or more original order dates.",
  COHORT_RANGE_TOO_LARGE: "Choose a shorter range to calculate order outcomes.",
  ESTIMATE_REQUIRES_PLACED_BASIS: "This estimate requires placed sales. Confirmed sales would risk double-adjusting unpaid orders.",
  INVALID_DIRECT_REVENUE: "Shopee direct and total revenue do not reconcile.",
  CALENDAR_ALIGNMENT_ESTIMATE: "Dates align ad report days with original order days in WIB. Shopee attribution timing can differ; this is an estimate.",
  SHARED_OUTCOME_ASSUMPTION: "Assumes advertised and organic orders have similar payment, cancellation and refund outcomes. This measures sales before costs and fees.",
  CURRENT_PRODUCT_MAPPING: "Uses the current campaign product mapping. Product changes in a campaign can affect historical estimates.",
  SMALL_COHORT: "At least one revenue day has fewer than 20 orders. Daily estimates can be volatile; compare 7 or 30 days.",
  PENDING_OUTCOMES: "Some orders or returns are in progress. Future outcomes can change the original date.",
  SHOP_RETENTION_FALLBACK: "Some direct sales lack a usable advertised-product cohort. Those sales use the shop-wide retention rate.",
  PROPORTIONAL_REFUND_ALLOCATION: "Order-level refunds are allocated to merchandise and products proportionally. Return cases and escrow refunds are not deducted twice.",
};
const reasons: Record<string, string> = {
  PAYMENT_OUTCOME_UNKNOWN: "Some attributed orders have unknown payment status. Refresh order details before calculating exact Real ROAS.",
  NO_ADS_DATA: "No advertising report is available for these dates.", ATTRIBUTION_INCOMPLETE: "The source report does not identify individual ad-attributed orders. Exact Real ROAS cannot be calculated from aggregate totals.",
  OUTCOME_COVERAGE_INCOMPLETE: "Cancellation and return outcomes are not complete in this report.", UNMATCHED_ATTRIBUTION: "Some attributed items cannot be matched to this shop's imported orders.",
  ATTRIBUTION_TOTAL_MISMATCH: "Credited item amounts do not reconcile with the original source revenue.", OUTCOMES_OUTDATED: "Order data changed after the report's outcome snapshot. Import an updated report.",
  RETURN_COVERAGE_INCOMPLETE: "A return is missing from the report's outcome evidence, or has a newer update.", PERIOD_COVERAGE_INCOMPLETE: "Some source periods are missing. Real ROAS for the whole selected range is unavailable.",
  DUPLICATE_ATTRIBUTION: "An attribution appears in more than one reporting period.", CREDIT_EXCEEDS_ORDER_LINE: "Credited amounts exceed a matched order item's merchandise value.",
  OUTCOME_TOTAL_MISMATCH: "Imported item adjustments conflict with known confirmed refunds for an attributed order.",
};
export default async function Advertisement({ searchParams }: { searchParams: Promise<ReportQuery> }) {
  const query = await searchParams;
  const period = pageReportPeriod(query);
  let data: AdvertisementData;
  try { data = await getAdvertisementData(period, adReportFilters(query)); }
  catch (error) {
    if (!(error instanceof AppError) || !["INVALID_REPORT_FILTER", "INVALID_ADS_DATASET"].includes(error.code)) throw error;
    return <><PageHeading title="Advertisement"/><Card><div className="empty-state"><h2>Choose a valid source report</h2><p>The source filter is invalid or unavailable in this workspace.</p><ReportLink href="/advertisement" className="text-link">Reset advertising filters</ReportLink></div></Card></>;
  }
  const result = data.summary;
  const estimate = data.estimate;
  const hasData = !result.issues.includes("NO_ADS_DATA");
  const syncIssue = adsSyncIssue(data.sync?.errorCode ?? null);
  const cards = [
    ["Ad spend", adsMoney(hasData ? result.spend : null), "Same spend in every ROAS calculation"],
    ["Original ROAS", adsRatio(result.originalRoas), "Source revenue ÷ source ad spend"],
    ["Real ROAS", adsRatio(result.realRoas), "Retained attributed revenue ÷ the same spend"],
    ["Original attributed revenue", adsMoney(hasData ? result.originalRevenue : null), "Before unpaid, cancellation and refund adjustments"],
    ["Retained attributed revenue", adsMoney(result.retainedRevenue), "After unpaid orders, cancellations and confirmed refunds"],
    ["Excluded revenue", adsMoney(result.excludedRevenue), "Unpaid, cancelled or refunded attributed sales"],
  ];
  return <>
    <PageHeading title="Advertisement" description="Track original ad sales and revenue retained after unpaid orders, cancellations and refunds."/>
    {data.mode === "live" && <Card className="ad-section">
      <AdsSyncControls connected={data.sync?.connected ?? false} pending={data.sync?.pending ?? false} intervalMinutes={data.sync?.intervalMinutes ?? 10} lastSyncLabel={timeLabel(data.sync?.lastSuccessAt ?? null)}/>
      {syncIssue && <p className="report-error" role="alert">{syncIssue}</p>}
      {!syncIssue && data.sync?.hourlyErrorCode && <p className="page-note">Hourly report: {adsSyncIssue(data.sync.hourlyErrorCode)}</p>}
      {!syncIssue && data.sync?.campaignErrorCode && <p className="page-note">Campaign report: {adsSyncIssue(data.sync.campaignErrorCode)}</p>}
      <p className="page-note">Daily shop and campaign totals refresh for the last 30 days. Hourly shop data covers today and yesterday. Shopee may revise attributed sales after a click.</p>
    </Card>}
    <p className="ad-basis">Basis: {data.basis?.toLowerCase().replaceAll("_", " ") ?? "Not available"} · WIB · {data.coverage.available} / {data.coverage.expected} source periods available. {data.coverage.available < data.coverage.expected && "Totals cover available records only; missing periods are not treated as zero."}</p>
    <dl className="metrics-grid ad-metrics">{cards.map(([label, value, note]) => <Metric key={label} label={label} value={value} note={note} featured={label === "Real ROAS"} testId={label === "Real ROAS" ? "real-roas" : label === "Original ROAS" ? "original-roas" : undefined}/>)}</dl>
    {estimate && <Card className="ad-section" role="region" aria-label="Estimated adjusted ROAS">
      <div className="card-heading"><div><h2>Estimated adjusted ROAS</h2><p>Recalculated from current order outcomes on the original order date. Ad spend stays unchanged.</p></div><Badge>Estimate</Badge></div>
      <dl className="metrics-grid">
        <Metric label="Estimated adjusted ROAS" value={adsRatio(estimate.roas)} note="Direct sales use product retention; other sales use shop retention" featured testId="estimated-roas"/>
        <Metric label="Estimated retained ad revenue" value={adsMoney(estimate.revenue)} note="Excludes unpaid, cancelled and confirmed refunded value"/>
        {data.campaignKey === "shop" && <Metric label="Retained shop revenue / ad spend" value={adsRatio(estimate.storeRoas)} note="Includes organic shop sales; this is not attributed ROAS"/>}
      </dl>
      <p className="page-note">{estimate.orders} orders in the original-date cohort · {estimate.pendingOrders} with pending outcomes · {estimate.unknownOrders} with unknown payment status. Outcomes last synced: {timeLabel(estimate.asOf)}.</p>
      <div className="table-scroll" tabIndex={0}><Table><caption className="sr-only">Shop merchandise cohort for the selected order dates</caption><TableHeader><TableRow><TableHead>Placed merchandise</TableHead><TableHead>Unpaid</TableHead><TableHead>Cancelled / cancelling</TableHead><TableHead>Confirmed refunds</TableHead><TableHead>Retained shop merchandise</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>{adsMoney(estimate.placedRevenue)}</TableCell><TableCell>{adsMoney(estimate.unpaidRevenue)}</TableCell><TableCell>{adsMoney(estimate.cancelledRevenue)}</TableCell><TableCell>{adsMoney(estimate.refundedRevenue)}</TableCell><TableCell>{adsMoney(estimate.storeRevenue)}</TableCell></TableRow></TableBody></Table></div>
      {!!estimate.issues.length && <div className="notice ad-quality" role="status"><strong>Estimate unavailable</strong><ul>{estimate.issues.map(issue => <li key={issue}>{estimateNotes[issue] ?? reasons[issue] ?? "Outcome reconciliation needs attention."}</li>)}</ul></div>}
      <p className="page-note">This approximation aligns report days with order dates and assumes similar outcomes for ad and organic sales. Compare 7 or 30 days for a steadier estimate.</p>
      <details className="ad-method"><summary>Estimate method and limitations</summary><p>Each day's direct ad revenue is multiplied by the retained merchandise share for its advertised products. Other attributed revenue uses the shop share. Ratios for longer ranges use summed revenue divided by summed spend.</p><ul>{estimate.warnings.map(issue => <li key={issue}>{estimateNotes[issue]}</li>)}</ul><p>Unpaid orders contribute zero until payment is confirmed. Cancelled and cancelling orders contribute zero. Accepted full or partial refunds reduce retained value, capped at the order's merchandise value. Later updates restate the original order day; the original source ROAS is preserved.</p></details>
    </Card>}
    {!!result.issues.length && <div className="notice ad-quality" role="status"><strong>{result.realRoas === null ? "Real ROAS unavailable" : "Report limitations"}</strong><ul>{result.issues.map(issue => <li key={issue}>{reasons[issue] ?? "Source reconciliation needs attention."}</li>)}</ul></div>}
    {result.provisional && <p className="page-note">Provisional: some order outcomes or the current reporting period are still in progress. Later cancellations and returns can revise these figures.</p>}
    <ReportingControls period={data.period}><AdvertisementFilters datasets={data.datasets} dataset={data.datasetKey} campaigns={data.campaigns} campaign={data.campaignKey}/></ReportingControls>
    <Card role="region" aria-label="ROAS chart"><div className="card-heading report-chart-heading"><div><h2>ROAS over time</h2><p>Ratios are calculated from revenue and spend sums in each time bucket.</p></div></div>{data.chartUnavailable ? <EmptyState title="Hourly breakdown unavailable">{data.chartUnavailable}</EmptyState> : result.issues.includes("NO_ADS_DATA") ? <EmptyState title="No advertising report in this period">Connect your shop and use Sync ads to fetch Shopee reports automatically, or import a source report below.</EmptyState> : <ReportChart data={data.points} series={[{ key: "original", label: "Original ROAS", color: "var(--chart-secondary)" }, { key: "real", label: "Real ROAS", color: "var(--chart-primary)" }, ...(estimate ? [{ key: "estimated", label: "Estimated adjusted ROAS", color: "var(--ink)" }] : [])]} unit="ROAS" label="Original and Real ROAS by reporting period"/>}</Card>
    <Card className="ad-section"><div className="card-heading"><div><h2>Campaign performance</h2><p>Each source scope is separate. Shop totals are not added to campaign totals.</p></div></div>{data.campaigns.length ? <div className="table-scroll" tabIndex={0}><Table><TableHeader><TableRow><TableHead>Source campaign / scope</TableHead><TableHead>Ad spend</TableHead><TableHead>Original ROAS</TableHead><TableHead>Real ROAS</TableHead>{estimate && <TableHead>Estimated adjusted ROAS</TableHead>}</TableRow></TableHeader><TableBody>{data.campaigns.map(row => <TableRow key={row.key}><TableCell>{row.name}</TableCell><TableCell>{adsMoney(row.spend)}</TableCell><TableCell>{adsRatio(row.originalRoas)}</TableCell><TableCell>{adsRatio(row.realRoas)}</TableCell>{estimate && <TableCell>{adsRatio(row.estimatedRoas ?? null)}</TableCell>}</TableRow>)}</TableBody></Table></div> : <EmptyState title="No campaign data">Import a campaign report or a canonical shop report.</EmptyState>}</Card>
    <Card className="ad-section"><div className="card-heading"><div><h2>Attributed items and adjustments</h2><p>Only items credited to advertising are included. Partial refunds reduce the credited amount.</p></div><Badge>{result.allocations} allocations</Badge></div>{result.lines.length ? <div className="table-scroll" tabIndex={0}><Table><TableHeader><TableRow><TableHead>Order / product</TableHead><TableHead>Credited revenue</TableHead><TableHead>Outcome</TableHead><TableHead>Retained</TableHead><TableHead>Excluded</TableHead></TableRow></TableHeader><TableBody>{result.lines.slice(0, 200).map((row, index) => <TableRow key={`${row.key}:${index}`}><TableCell><ReportLink href={`/orders/${encodeURIComponent(row.orderSn)}`} className="text-link">{row.orderSn}</ReportLink><div className="subtext">{row.name ?? "Item match missing"}{row.sku ? ` / ${row.sku}` : ""}</div></TableCell><TableCell>{adsMoney(row.credited)}</TableCell><TableCell>{row.outcome.toLowerCase()}</TableCell><TableCell>{adsMoney(row.retained)}</TableCell><TableCell>{adsMoney(row.excluded)}</TableCell></TableRow>)}</TableBody></Table></div> : <EmptyState title="No item attribution available">Aggregate ad totals alone cannot establish exact adjusted ROAS.</EmptyState>}{result.lines.length > 200 && <p className="page-note">Showing 200 of {result.lines.length} allocations. Calculations include all records.</p>}</Card>
    <Card className="ad-section"><div className="card-heading"><div><h2>Import an advertising report</h2><p>Add a source report with advertising spend, revenue, and attributed items.</p></div></div><AdvertisementImport disabled={data.mode === "demo"}/></Card>
    <details className="ad-method"><summary>How Real ROAS is calculated</summary><p>Real ROAS uses credited revenue that remains after confirmed cancellations, returns, and refunds. A cancelled or returned allocation is worth zero even if a refund appears later. Expenses remain in the denominator. This measures retained sales before product costs and marketplace fees.</p><p>Reports need explicit attribution and current outcome evidence. Raw daily totals cannot be converted into an hourly graph, and organic returns are not deducted from advertising revenue.</p><p>Source last updated: {timeLabel(result.asOf)}. {data.datasetKey === SHOPEE_ADS_DATASET ? "Shopee Ads totals use total sales attributed within 7 days of a click. This API does not identify the individual orders, so exact Real ROAS remains unavailable." : "Uploaded reports remain separate from automatically synced Shopee totals."}</p></details>
  </>;
}
