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

const reasons: Record<string, string> = {
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
  const hasData = !result.issues.includes("NO_ADS_DATA");
  const syncIssue = adsSyncIssue(data.sync?.errorCode ?? null);
  const cards = [
    ["Ad spend", adsMoney(hasData ? result.spend : null), "Included in both ROAS calculations"],
    ["Original ROAS", adsRatio(result.originalRoas), "Source revenue ÷ source ad spend"],
    ["Real ROAS", adsRatio(result.realRoas), "Retained attributed revenue ÷ the same spend"],
    ["Original attributed revenue", adsMoney(hasData ? result.originalRevenue : null), "Before cancellation and return adjustments"],
    ["Retained attributed revenue", adsMoney(result.retainedRevenue), "After confirmed cancellations and returns"],
    ["Excluded revenue", adsMoney(result.excludedRevenue), "Cancelled or refunded attributed sales"],
  ];
  return <>
    <PageHeading title="Advertisement" description="Compare Original ROAS with revenue retained after cancellations and returns."/>
    {data.mode === "live" && <Card className="ad-section">
      <AdsSyncControls connected={data.sync?.connected ?? false} pending={data.sync?.pending ?? false} intervalMinutes={data.sync?.intervalMinutes ?? 10} lastSyncLabel={timeLabel(data.sync?.lastSuccessAt ?? null)}/>
      {syncIssue && <p className="report-error" role="alert">{syncIssue}</p>}
      {!syncIssue && data.sync?.hourlyErrorCode && <p className="page-note">Hourly report: {adsSyncIssue(data.sync.hourlyErrorCode)}</p>}
      {!syncIssue && data.sync?.campaignErrorCode && <p className="page-note">Campaign report: {adsSyncIssue(data.sync.campaignErrorCode)}</p>}
      <p className="page-note">Daily shop and campaign totals refresh for the last 30 days. Hourly shop data covers today and yesterday. Shopee may revise attributed sales after a click.</p>
    </Card>}
    <p className="ad-basis">Basis: {data.basis?.toLowerCase().replaceAll("_", " ") ?? "Not available"} · WIB · {data.coverage.available} / {data.coverage.expected} source periods available. {data.coverage.available < data.coverage.expected && "Totals cover available records only; missing periods are not treated as zero."}</p>
    <dl className="metrics-grid ad-metrics">{cards.map(([label, value, note]) => <Metric key={label} label={label} value={value} note={note} featured={label === "Real ROAS"} testId={label === "Real ROAS" ? "real-roas" : label === "Original ROAS" ? "original-roas" : undefined}/>)}</dl>
    {!!result.issues.length && <div className="notice ad-quality" role="status"><strong>{result.realRoas === null ? "Real ROAS unavailable" : "Report limitations"}</strong><ul>{result.issues.map(issue => <li key={issue}>{reasons[issue] ?? "Source reconciliation needs attention."}</li>)}</ul></div>}
    {result.provisional && <p className="page-note">Provisional: some order outcomes or the current reporting period are still in progress. Later cancellations and returns can revise these figures.</p>}
    <ReportingControls period={data.period}><AdvertisementFilters datasets={data.datasets} dataset={data.datasetKey} campaigns={data.campaigns} campaign={data.campaignKey}/></ReportingControls>
    <Card role="region" aria-label="ROAS chart"><div className="card-heading report-chart-heading"><div><h2>Original and Real ROAS</h2><p>Ratios are calculated from revenue and spend sums in each time bucket.</p></div></div>{data.chartUnavailable ? <EmptyState title="Hourly breakdown unavailable">{data.chartUnavailable}</EmptyState> : result.issues.includes("NO_ADS_DATA") ? <EmptyState title="No advertising report in this period">Connect your shop and use Sync ads to fetch Shopee reports automatically, or import a source report below.</EmptyState> : <ReportChart data={data.points} series={[{ key: "original", label: "Original ROAS", color: "var(--chart-secondary)" }, { key: "real", label: "Real ROAS", color: "var(--chart-primary)" }]} unit="ROAS" label="Original and Real ROAS by reporting period"/>}</Card>
    <Card className="ad-section"><div className="card-heading"><div><h2>Campaign performance</h2><p>Each source scope is separate. Shop totals are not added to campaign totals.</p></div></div>{data.campaigns.length ? <div className="table-scroll" tabIndex={0}><Table><TableHeader><TableRow><TableHead>Source campaign / scope</TableHead><TableHead>Ad spend</TableHead><TableHead>Original ROAS</TableHead><TableHead>Real ROAS</TableHead></TableRow></TableHeader><TableBody>{data.campaigns.map(row => <TableRow key={row.key}><TableCell>{row.name}</TableCell><TableCell>{adsMoney(row.spend)}</TableCell><TableCell>{adsRatio(row.originalRoas)}</TableCell><TableCell>{adsRatio(row.realRoas)}</TableCell></TableRow>)}</TableBody></Table></div> : <EmptyState title="No campaign data">Import a campaign report or a canonical shop report.</EmptyState>}</Card>
    <Card className="ad-section"><div className="card-heading"><div><h2>Attributed items and adjustments</h2><p>Only items credited to advertising are included. Partial refunds reduce the credited amount.</p></div><Badge>{result.allocations} allocations</Badge></div>{result.lines.length ? <div className="table-scroll" tabIndex={0}><Table><TableHeader><TableRow><TableHead>Order / product</TableHead><TableHead>Credited revenue</TableHead><TableHead>Outcome</TableHead><TableHead>Retained</TableHead><TableHead>Excluded</TableHead></TableRow></TableHeader><TableBody>{result.lines.slice(0, 200).map((row, index) => <TableRow key={`${row.key}:${index}`}><TableCell><ReportLink href={`/orders/${encodeURIComponent(row.orderSn)}`} className="text-link">{row.orderSn}</ReportLink><div className="subtext">{row.name ?? "Item match missing"}{row.sku ? ` / ${row.sku}` : ""}</div></TableCell><TableCell>{adsMoney(row.credited)}</TableCell><TableCell>{row.outcome.toLowerCase()}</TableCell><TableCell>{adsMoney(row.retained)}</TableCell><TableCell>{adsMoney(row.excluded)}</TableCell></TableRow>)}</TableBody></Table></div> : <EmptyState title="No item attribution available">Aggregate ad totals alone cannot establish exact adjusted ROAS.</EmptyState>}{result.lines.length > 200 && <p className="page-note">Showing 200 of {result.lines.length} allocations. Calculations include all records.</p>}</Card>
    <Card className="ad-section"><div className="card-heading"><div><h2>Import an advertising report</h2><p>Add a source report with advertising spend, revenue, and attributed items.</p></div></div><AdvertisementImport disabled={data.mode === "demo"}/></Card>
    <details className="ad-method"><summary>How Real ROAS is calculated</summary><p>Real ROAS uses credited revenue that remains after confirmed cancellations, returns, and refunds. A cancelled or returned allocation is worth zero even if a refund appears later. Expenses remain in the denominator. This measures retained sales before product costs and marketplace fees.</p><p>Reports need explicit attribution and current outcome evidence. Raw daily totals cannot be converted into an hourly graph, and organic returns are not deducted from advertising revenue.</p><p>Source last updated: {timeLabel(result.asOf)}. {data.datasetKey === SHOPEE_ADS_DATASET ? "Shopee Ads totals use total sales attributed within 7 days of a click. This API does not identify the individual orders, so exact Real ROAS remains unavailable." : "Uploaded reports remain separate from automatically synced Shopee totals."}</p></details>
  </>;
}
