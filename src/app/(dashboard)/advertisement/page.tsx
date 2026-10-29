import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAdvertisementData, adReportFilters, type AdvertisementData } from "@/server/ads";
import { AppError } from "@/core/errors";
import { pageReportPeriod, type ReportQuery } from "@/core/reporting-period";
import { ReportingControls } from "@/components/reporting-controls";
import { AdvertisementFilters } from "@/components/advertisement-controls";
import { ReportChart } from "@/components/report-chart";
import { ReportLink } from "@/components/report-link";
import { Card, EmptyState, PageHeading, Metric } from "@/components/ui";
import { adsMoney, adsRatio } from "@/lib/ads-format";
import { timeLabel } from "@/lib/format";
import { AdsSyncControls } from "@/components/ads-sync-controls";
import { adsSyncIssue } from "@/core/shopee-ads";
import { advertisingCost } from "@/core/ads-cost";

const estimateErrors: Record<string, string> = {
  ORDER_SYNC_INCOMPLETE: "Sync your shop to complete order history for these dates.",
  RETURN_SYNC_INCOMPLETE: "Sync your shop to complete return history for these dates.",
  OUTCOME_SYNC_STALE: "Order or return data needs refreshing before an estimate is available.",
  PAYMENT_OUTCOME_UNKNOWN: "Some orders need refreshed payment details before an estimate is available.",
  REFUND_AMOUNT_UNKNOWN: "A confirmed return is missing its refund amount.",
  NO_ORDER_COHORT: "Some ad sales have no matching order-date history.",
  COHORT_RANGE_TOO_LARGE: "Choose a shorter date range to calculate the estimate.",
  ESTIMATE_REQUIRES_PLACED_BASIS: "Choose the automatically synced source for adjusted estimates.",
  INVALID_DIRECT_REVENUE: "Shopee direct and total revenue do not reconcile.",
  PERIOD_COVERAGE_INCOMPLETE: "Some ad periods are missing. Sync ads or choose a shorter range.",
};

export default async function Advertisement({ searchParams }: { searchParams: Promise<ReportQuery> }) {
  const query = await searchParams;
  const period = pageReportPeriod(query);
  let data: AdvertisementData;
  try { data = await getAdvertisementData(period, adReportFilters(query)); }
  catch (error) {
    if (!(error instanceof AppError) || !["INVALID_REPORT_FILTER", "INVALID_ADS_DATASET"].includes(error.code)) throw error;
    return <><PageHeading title="Advertisement"/><Card><div className="empty-state"><h2>Choose a valid source report</h2><ReportLink href="/advertisement" className="text-link">Reset filters</ReportLink></div></Card></>;
  }
  const result = data.summary;
  const estimate = data.estimate;
  const hasData = !result.issues.includes("NO_ADS_DATA");
  const adCost = hasData ? advertisingCost(result.spend) : null;
  const cards = [
    { label: "Ad Spend", value: adsMoney(adCost?.total ?? null), note: adCost ? `Base ${adsMoney(adCost.spend)} + PPN 11% ${adsMoney(adCost.ppn)}` : undefined, id: "ad-spend" },
    { label: "Original ROAS", value: adsRatio(result.originalRoas), note: "Shopee ROAS · before PPN", id: "original-roas" },
    { label: "Estimated Adjusted ROAS", value: adsRatio(estimate?.roas ?? null), note: "After exclusions and 11% PPN", id: "estimated-roas" },
    { label: "Original Revenue", value: adsMoney(hasData ? result.originalRevenue : null), id: "original-revenue" },
    { label: "Estimated Revenue", value: adsMoney(estimate?.revenue ?? null), id: "estimated-revenue" },
    { label: "Cancelled, Unpaid & Refunded Revenue", value: adsMoney(estimate?.excluded ?? null), id: "adjusted-outcomes-revenue" },
  ];
  const estimateIssue = estimate?.issues.find(issue => issue !== "NO_ADS_DATA");
  const problems = [...new Set([
    adsSyncIssue(data.sync?.errorCode ?? null),
    data.sync?.hourlyErrorCode ? "Hourly data: " + adsSyncIssue(data.sync.hourlyErrorCode) : null,
    data.sync?.campaignErrorCode ? "Campaign data: " + adsSyncIssue(data.sync.campaignErrorCode) : null,
    hasData && estimateIssue ? estimateErrors[estimateIssue] ?? "Refresh order outcomes to calculate the estimate." : null,
  ].filter((message): message is string => !!message))];
  return <div className="campaign-page">
    <PageHeading title="Advertisement" actions={data.mode === "live" ? <AdsSyncControls connected={data.sync?.connected ?? false} pending={data.sync?.pending ?? false} intervalMinutes={data.sync?.intervalMinutes ?? 10} lastSyncLabel={timeLabel(data.sync?.lastSuccessAt ?? null)}/> : undefined}/>
    <dl className="metrics-grid campaign-metrics" aria-label="Advertising summary">
      {cards.map(card => <Metric key={card.id} label={card.label} value={card.value} note={card.note} featured={card.id === "estimated-roas"} testId={card.id}/>)}
    </dl>
    {problems.length > 0 && <div className="notice" role="status">{problems.join(" ")}</div>}
    <ReportingControls period={data.period}><AdvertisementFilters datasets={data.datasets} dataset={data.datasetKey} campaigns={data.campaigns} campaign={data.campaignKey}/></ReportingControls>
    <Card role="region" aria-label="ROAS chart">
      <div className="card-heading"><h2>ROAS over time</h2></div>
      {data.chartUnavailable ? <EmptyState title="Hourly breakdown unavailable">{data.chartUnavailable}</EmptyState> : !hasData ? <EmptyState title="No ad data for these dates">Connect your shop and sync ads.</EmptyState> : <ReportChart data={data.points} series={[
        { key: "original", label: "Original ROAS", color: "var(--chart-secondary)" },
        { key: "estimated", label: "Estimated Adjusted ROAS", color: "var(--chart-primary)" },
      ]} unit="ROAS" label="Original and estimated adjusted ROAS by reporting period"/>}
    </Card>
    <Card role="region" aria-label="Campaign performance">
      <div className="card-heading"><h2>Campaign performance</h2></div>
      {data.campaigns.length ? <div className="table-scroll" tabIndex={0}><Table><TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>Ad Spend (excl. PPN)</TableHead><TableHead>PPN (11%)</TableHead><TableHead>Total Ad Cost</TableHead><TableHead>Original ROAS</TableHead><TableHead>Estimated Adjusted ROAS</TableHead></TableRow></TableHeader><TableBody>{data.campaigns.map(row => { const cost = advertisingCost(row.spend); return <TableRow key={row.key}><TableCell>{row.name}</TableCell><TableCell>{adsMoney(cost.spend)}</TableCell><TableCell>{adsMoney(cost.ppn)}</TableCell><TableCell>{adsMoney(cost.total)}</TableCell><TableCell>{adsRatio(row.originalRoas)}</TableCell><TableCell>{adsRatio(row.estimatedRoas ?? null)}</TableCell></TableRow>; })}</TableBody></Table></div> : <EmptyState title="No campaign data">Sync ads to load your campaigns.</EmptyState>}
    </Card>
  </div>;
}
