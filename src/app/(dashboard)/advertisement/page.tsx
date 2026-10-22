import { getAdvertisementData, adReportFilters, type AdvertisementData } from "@/server/ads";
import { AppError } from "@/core/errors";
import { pageReportPeriod, type ReportQuery } from "@/core/reporting-period";
import { ReportingControls } from "@/components/reporting-controls";
import { AdvertisementFilters, AdvertisementImport } from "@/components/advertisement-controls";
import { ReportChart } from "@/components/report-chart";
import { ReportLink } from "@/components/report-link";
import { Card, Badge, EmptyState } from "@/components/ui";
import { adsMoney, adsRatio } from "@/lib/ads-format";
import { timeLabel } from "@/lib/format";

const reasons: Record<string, string> = {
  NO_ADS_DATA: "No advertising report is available for these dates.", ATTRIBUTION_INCOMPLETE: "The source report does not provide complete ad-to-item attribution.",
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
    return <><div className="page-heading"><h1>Advertisement.</h1></div><Card><div className="empty-state"><h2>Choose a valid source report</h2><p>The source filter is invalid or unavailable in this workspace.</p><ReportLink href="/advertisement" className="text-link">Reset advertising filters</ReportLink></div></Card></>;
  }
  const result = data.summary;
  const hasData = !result.issues.includes("NO_ADS_DATA");
  const cards = [
    ["Ad spend", adsMoney(hasData ? result.spend : null), "Advertising cost remains included"],
    ["Original ROAS", adsRatio(result.originalRoas), "Source revenue ÷ source ad spend"],
    ["Real ROAS", adsRatio(result.realRoas), "Retained attributed revenue ÷ the same spend"],
    ["Original attributed revenue", adsMoney(hasData ? result.originalRevenue : null), "Original source reporting basis"],
    ["Retained attributed revenue", adsMoney(result.retainedRevenue), "After confirmed cancellations and returns"],
    ["Excluded revenue", adsMoney(result.excludedRevenue), "Each revenue loss counted once"],
  ];
  return <>
    <div className="page-heading"><div><p className="eyebrow">WHAT YOUR ADS REALLY RETURN</p><h1>Advertisement.</h1><p className="page-description">Compare Shopee's original revenue with the attributed sales you retain.</p></div><Badge tone={data.mode === "demo" ? "orange" : "neutral"}>{data.mode === "demo" ? "Illustrative sample" : "Imported source reports"}</Badge></div>
    <p className="ad-basis">Basis: {data.basis?.toLowerCase().replaceAll("_", " ") ?? "Not available"} · WIB · {data.coverage.available} / {data.coverage.expected} source periods available. {data.coverage.available < data.coverage.expected && "Totals cover available records only; missing periods are not treated as zero."}</p>
    <div className="metrics-grid ad-metrics">{cards.map(([label, value, note]) => <Card key={label} className={`metric-card ${label === "Real ROAS" ? "metric-featured" : ""}`}><div className="metric-top">{label}</div><div className="metric-value numeric" data-testid={label === "Real ROAS" ? "real-roas" : label === "Original ROAS" ? "original-roas" : undefined}>{value}</div><p>{note}</p></Card>)}</div>
    {!!result.issues.length && <div className="notice ad-quality" role="status"><strong>Real ROAS needs complete evidence.</strong><ul>{result.issues.map(issue => <li key={issue}>{reasons[issue] ?? "Source reconciliation needs attention."}</li>)}</ul></div>}
    {result.provisional && <p className="page-note">Provisional: some order outcomes or the current reporting period are still in progress. Later cancellations and returns can revise these figures.</p>}
    <ReportingControls period={data.period}><AdvertisementFilters datasets={data.datasets} dataset={data.datasetKey} campaigns={data.campaigns} campaign={data.campaignKey}/></ReportingControls>
    <Card role="region" aria-label="ROAS chart"><div className="card-heading report-chart-heading"><div><h2>Original and Real ROAS</h2><p>Ratios are calculated from revenue and spend sums in each time bucket.</p></div></div>{data.chartUnavailable ? <EmptyState title="Hourly breakdown unavailable">{data.chartUnavailable}</EmptyState> : result.issues.includes("NO_ADS_DATA") ? <EmptyState title="Your ad reports will appear here">Import a source report to compare advertising performance. Missing attribution keeps Real ROAS unavailable.</EmptyState> : <ReportChart data={data.points} series={[{ key: "original", label: "Original ROAS", color: "#a1aaa6" }, { key: "real", label: "Real ROAS", color: "#127a68" }]} unit="ROAS" label="Original and Real ROAS by reporting period"/>}</Card>
    <Card className="ad-section"><div className="card-heading"><div><h2>Campaign performance</h2><p>Each source scope is separate. Shop totals are not added to campaign totals.</p></div></div>{data.campaigns.length ? <div className="table-scroll"><table><thead><tr><th>Source campaign / scope</th><th>Ad spend</th><th>Original ROAS</th><th>Real ROAS</th></tr></thead><tbody>{data.campaigns.map(row => <tr key={row.key}><td>{row.name}</td><td>{adsMoney(row.spend)}</td><td>{adsRatio(row.originalRoas)}</td><td>{adsRatio(row.realRoas)}</td></tr>)}</tbody></table></div> : <EmptyState title="No campaign data yet">Import a campaign report or a canonical shop report.</EmptyState>}</Card>
    <Card className="ad-section"><div className="card-heading"><div><h2>Attributed items and adjustments</h2><p>Only items credited to advertising are included. Partial refunds reduce the credited amount.</p></div><Badge>{result.allocations} allocations</Badge></div>{result.lines.length ? <div className="table-scroll"><table><thead><tr><th>Order / product</th><th>Credited revenue</th><th>Outcome</th><th>Retained</th><th>Excluded</th></tr></thead><tbody>{result.lines.slice(0, 200).map((row, index) => <tr key={`${row.key}:${index}`}><td><ReportLink href={`/orders/${encodeURIComponent(row.orderSn)}`} className="text-link">{row.orderSn}</ReportLink><div className="subtext">{row.name ?? "Item match missing"}{row.sku ? ` / ${row.sku}` : ""}</div></td><td>{adsMoney(row.credited)}</td><td>{row.outcome.toLowerCase()}</td><td>{adsMoney(row.retained)}</td><td>{adsMoney(row.excluded)}</td></tr>)}</tbody></table></div> : <EmptyState title="No item attribution available">Aggregate ad totals alone cannot establish exact adjusted ROAS.</EmptyState>}{result.lines.length > 200 && <p className="page-note">Showing 200 of {result.lines.length} allocations. Calculations include all records.</p>}</Card>
    <Card className="ad-section"><div className="card-heading"><div><h2>Import an advertising report</h2><p>Private to this workspace. Existing orders and ad spend are preserved.</p></div></div><AdvertisementImport disabled={data.mode === "demo"}/></Card>
    <details className="ad-method"><summary>How Real ROAS is calculated</summary><p>Real ROAS uses credited revenue that remains after confirmed cancellations, returns, and refunds. A cancelled or returned allocation is worth zero even if a refund appears later. Expenses remain in the denominator. This measures retained sales before product costs and marketplace fees.</p><p>Reports need explicit attribution and current outcome evidence. Raw daily totals cannot be converted into an hourly graph, and organic returns are not deducted from advertising revenue.</p><p>Last source evidence: {timeLabel(result.asOf)}. Uploads are normalized source reports; automatic Shopee Ads attribution ingestion has not been verified for this connection.</p></details>
  </>;
}
