import { OverviewComparison } from "@/components/overview-comparison";
import { overviewComparisonPeriod } from "@/core/period-comparison";
import { cancellationDetails } from "@/core/cancellations";
import { orderStatusSummary } from "@/core/order-status";
import { isOverviewOrder } from "@/core/overview-sales";
import { ProductProfitChart } from "@/components/product-profit-chart";
import { CostBreakdown } from "@/components/cost-breakdown";
import { FinanceSyncButton } from "@/components/finance-sync-button";
import { ReportLink } from "@/components/report-link";
import { getDashboardData } from "@/server/dashboard";
import { getAdvertisementData } from "@/server/ads";
import { profitAfterAdSpend } from "@/core/overview-profit";
import { advertisingCost } from "@/core/ads-cost";
import { rupiah, number, timeLabel } from "@/lib/format";
import { Card, EmptyState, PageHeading, Metric } from "@/components/ui";
import { Icon } from "@/components/icons";
import { OverviewTrend } from "@/components/overview-trend";
import { ReportingControls } from "@/components/reporting-controls";
import { pageReportPeriod, type ReportQuery } from "@/core/reporting-period";
import { OrderTable } from "@/components/order-table";
import { SyncButton } from "@/components/sync-button";

export default async function Overview({ searchParams }: { searchParams: Promise<ReportQuery> }) {
  const period = pageReportPeriod(await searchParams);
  const previousPeriod = overviewComparisonPeriod(period);
  const [data, ads, previousData, previousAds] = await Promise.all([
    getDashboardData(period),
    getAdvertisementData(period, { campaign: "shop" }),
    previousPeriod ? getDashboardData(previousPeriod) : null,
    previousPeriod ? getAdvertisementData(previousPeriod, { campaign: "shop" }) : null,
  ]);
  const status = data.orderStatus ?? orderStatusSummary(data.orders);
  const cancelled = cancellationDetails(data.cancellations ?? { all: status.cancelled, paid: 0, unpaid: 0, returned: 0, unknown: status.cancelled });
  const demo = data.mode === "demo";
  const adSpend = ads.coverage.available > 0 ? ads.summary.spend : null;
  const adCost = adSpend === null ? null : advertisingCost(adSpend);
  const adsComplete = ads.coverage.available > 0 && ads.coverage.available === ads.coverage.expected;
  const netProfit = profitAfterAdSpend(data.metrics.profit, adsComplete ? adSpend : null);
  const previousAdSpend = previousAds && previousAds.coverage.available > 0 ? previousAds.summary.spend : null;
  const previousAdCost = previousAdSpend === null ? null : advertisingCost(previousAdSpend);
  const previousAdsComplete = previousAds && previousAds.coverage.available > 0 && previousAds.coverage.available === previousAds.coverage.expected;
  const previousProfit = previousData ? profitAfterAdSpend(previousData.metrics.profit, previousAdsComplete ? previousAdSpend : null) : null;
  const comparisons = previousPeriod && previousData ? [
    { current: data.metrics.sales, previous: previousData.metrics.sales, format: rupiah },
    { current: data.metrics.orders, previous: previousData.metrics.orders, format: number },
    { current: netProfit, previous: previousProfit, format: rupiah },
    { current: adCost === null ? null : Number(adCost.total), previous: previousAdCost === null ? null : Number(previousAdCost.total), format: rupiah, lowerIsBetter: true },
  ] : null;
  // Both reports use the same time buckets. Do not allocate daily spend to hours.
  const trend = data.trend.map((point, index) => {
    const spend = ads.period.effectiveInterval === period.effectiveInterval ? ads.points[index]?.spend ?? null : null;
    return { ...point, profit: profitAfterAdSpend(point.profit, spend), completedProfit: profitAfterAdSpend(point.completedProfit, spend) };
  });
  const cards = [
    { label: "Sales", value: rupiah(data.metrics.sales), note: "Paid orders by order date, after confirmed refunds", icon: "money" },
    { label: "Orders placed", value: number(data.metrics.orders), note: `${data.metrics.completed} completed / ${data.metrics.cancelled} cancelled (unpaid excluded)`, icon: "orders" },
    { label: "Net profit", value: rupiah(netProfit), note: !adsComplete ? "Waiting for complete ad spend data" : data.profitSummary ? `${data.profitSummary.covered} / ${data.profitSummary.eligible} completed orders � ${data.profitSummary.estimated ? "includes estimated costs" : "after COGS, Shopee deductions and ads"}` : demo && netProfit !== null ? "Sample payouts, COGS and ad spend" : "Waiting for payouts and COGS", icon: "products" },
    { label: "Ad spend", value: rupiah(adCost === null ? null : Number(adCost.total)), note: adCost === null ? "Waiting for ad sync" : `${!adsComplete ? "Partial data · " : ""}Base ${rupiah(Number(adCost.spend))} + PPN 11% ${rupiah(Number(adCost.ppn))}`, icon: "advertisement" },
  ];
  const topProducts = [...data.products].sort((a, b) => b.units - a.units).slice(0, 4);
  return <>
    <PageHeading title="Overview" actions={<div className="flex flex-wrap items-start gap-2">{data.shop && <FinanceSyncButton shopId={data.shop.id} disabled={demo || data.shop.status !== "CONNECTED"}/>}<SyncButton shopId={data.shop?.id} disabled={demo || data.shop?.status !== "CONNECTED"}/></div>}/>
    <dl className="metrics-grid">{cards.map((card, index) => <Metric key={card.label} label={card.label} value={card.value} note={card.note} icon={card.icon} featured={index === 0} comparison={comparisons && previousPeriod ? <OverviewComparison {...comparisons[index]} label={previousPeriod.label}/> : undefined}/>)}</dl>
    <ReportingControls period={period}/>
    <div className="analytics-grid">
      <Card role="region" aria-label="Sales chart">{trend.length ? <OverviewTrend data={trend}/> : <><div className="card-heading"><h2>Sales over time</h2></div><EmptyState title="No sales in this period">Connect a shop or choose a different date range.</EmptyState></>}</Card>
      <Card className="status-card" role="region" aria-label="Order status">
        <div className="card-heading"><h2>Order status</h2></div>
        <div className="status-total"><span>{number(status.total)}</span><p>orders placed</p></div>
        <div className="status-bar"><i style={{ width: `${status.total ? status.completed / status.total * 100 : 0}%` }}/><b style={{ width: `${status.total ? status.cancelled / status.total * 100 : 0}%` }}/></div>
        <div className="status-legend">
          <div><span><i className="dot dot-green"/>Completed</span><strong>{number(status.completed)}</strong></div>
          <div><span><i className="dot dot-orange"/>In progress</span><strong>{number(status.inProgress)}</strong></div>
          <ul className="status-details" aria-label="In progress breakdown">{status.details.map(detail => <li key={detail.status}><span>{detail.label}</span><strong>{number(detail.count)}</strong></li>)}</ul>
          <div><span><i className="dot dot-red"/>Cancelled</span><strong>{number(status.cancelled)}</strong></div>
          <ul className="status-details" aria-label="Cancelled breakdown">{cancelled.map(detail => <li key={detail.key}><span>{detail.label}</span><strong>{number(detail.count)}</strong></li>)}</ul>
        </div>
        <p className="status-footnote">Unpaid orders excluded. Cancelled orders stay visible.</p>
      </Card>
    </div>
    <div className="profit-grid">
      <CostBreakdown summary={data.costSummary} adSpend={adSpend} adsComplete={adsComplete}/>
      <ProductProfitChart base={data.productProfit} ads={ads.productSpend} names={data.products.map(({ sourceItemId, name }) => ({ sourceItemId, name }))} adsComplete={adsComplete}/>
    </div>
    <div className="lower-grid">
      <Card className="orders-card"><div className="card-heading"><div><h2>Recent orders</h2></div><ReportLink href="/orders" className="text-link">View all <Icon name="arrow" size={14}/></ReportLink></div><OrderTable orders={data.orders.filter(isOverviewOrder).slice(0, 5)}/></Card>
      <Card className="product-ranking"><div className="card-heading"><div><h2>Top products</h2><p>By completed units in the selected period</p></div></div>{data.products.length ? topProducts.map((product, index) => <div className="rank-row" key={product.id}><span className="rank-number">0{index + 1}</span><div className="rank-detail"><strong>{product.name}</strong><span>{product.variants.length} {product.variants.length === 1 ? "variation" : "variations"}</span></div><strong className="rank-units">{product.units}<small>sold</small></strong></div>) : <EmptyState title="No completed product sales">Products appear here when completed orders fall within this period.</EmptyState>}<ReportLink href="/products" className="ranking-link">Manage product costs <Icon name="arrow" size={14}/></ReportLink></Card>
    </div>
    <div className="freshness"><span><Icon name="clock" size={14}/>{demo ? "Sample data for preview" : `Orders last synced: ${timeLabel(data.lastSyncedAt)}`}</span><span>Payouts last refreshed: {timeLabel(data.profitSummary?.lastSyncedAt ?? null)}</span></div>
  </>;
}
