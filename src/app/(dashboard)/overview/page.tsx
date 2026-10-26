import { CostBreakdown } from "@/components/cost-breakdown";
import { FinanceSyncButton } from "@/components/finance-sync-button";
import { ReportLink } from "@/components/report-link";
import { getDashboardData } from "@/server/dashboard";
import { getAdvertisementData } from "@/server/ads";
import { profitAfterAdSpend } from "@/core/overview-profit";
import { rupiah, number, timeLabel } from "@/lib/format";
import { Card, EmptyState, PageHeading, Metric } from "@/components/ui";
import { Icon } from "@/components/icons";
import { OverviewTrend } from "@/components/overview-trend";
import { ReportingControls } from "@/components/reporting-controls";
import { pageReportPeriod, type ReportQuery } from "@/core/reporting-period";
import { OrderTable } from "@/components/order-table";
import { SyncButton, AutoSync } from "@/components/sync-button";

export default async function Overview({ searchParams }: { searchParams: Promise<ReportQuery> }) {
  const period = pageReportPeriod(await searchParams);
  const [data, ads] = await Promise.all([
    getDashboardData(period),
    getAdvertisementData(period, { campaign: "shop" }),
  ]);
  const demo = data.mode === "demo";
  const adSpend = ads.coverage.available > 0 ? ads.summary.spend : null;
  const adsComplete = ads.coverage.available > 0 && ads.coverage.available === ads.coverage.expected;
  const netProfit = profitAfterAdSpend(data.metrics.profit, adsComplete ? adSpend : null);
  // Both reports use the same time buckets. Do not allocate daily spend to hours.
  const trend = data.trend.map((point, index) => ({ ...point, profit: profitAfterAdSpend(point.profit,
    ads.period.effectiveInterval === period.effectiveInterval ? ads.points[index]?.spend ?? null : null) }));
  const cards = [
    { label: "Completed sales", value: rupiah(data.metrics.sales), note: "Merchandise before refunds and fees", icon: "money" },
    { label: "Orders placed", value: number(data.metrics.orders), note: `${data.metrics.completed} completed / ${data.metrics.cancelled} cancelled (all orders)`, icon: "orders" },
    { label: "Net profit", value: rupiah(netProfit), note: !adsComplete ? "Waiting for complete ad spend data" : data.profitSummary ? `${data.profitSummary.covered} / ${data.profitSummary.eligible} completed orders · ${data.profitSummary.estimated ? "includes estimated costs" : "after COGS, Shopee deductions and ads"}` : "Waiting for payouts and COGS", icon: "products" },
    { label: "Ad spend", value: rupiah(adSpend === null ? null : Number(adSpend)), note: adSpend === null ? "Waiting for ad sync" : !adsComplete ? "Partial data for the selected period" : "Shop advertising in the selected period", icon: "advertisement" },
  ];
  const topProducts = [...data.products].sort((a, b) => b.units - a.units).slice(0, 4);
  return <>
    <AutoSync shopId={data.shop?.id} enabled={!demo && data.shop?.status === "CONNECTED"} lastSyncedAt={data.lastSyncedAt}/>
    <PageHeading title="Overview" actions={<div className="flex flex-wrap items-start gap-2">{data.shop && <FinanceSyncButton shopId={data.shop.id} disabled={demo || data.shop.status !== "CONNECTED"}/>}<SyncButton shopId={data.shop?.id} disabled={demo || data.shop?.status !== "CONNECTED"}/></div>}/>
    <dl className="metrics-grid">{cards.map((card, index) => <Metric key={card.label} label={card.label} value={card.value} note={card.note} icon={card.icon} featured={index === 0}/>)}</dl>
    {data.profitSummary && <p className="mb-5 text-xs text-muted-foreground">Net profit = Shopee payout − recorded COGS − ad spend. Payout already includes Shopee fees, affiliate commissions, refunds and adjustments.{data.profitSummary.covered < data.profitSummary.eligible ? " Orders missing costs or payouts are excluded from this subtotal." : ""}{data.profitSummary.error ? " Some payouts are awaiting refresh." : ""}</p>}
    {data.cancellations && <p className="mb-5 text-xs text-muted-foreground">Cancellations: {data.cancellations.paid} paid · {data.cancellations.unpaid} unpaid · {data.cancellations.returned} returned/refunded{data.cancellations.unknown > 0 ? ` · ${data.cancellations.unknown} awaiting payment details` : ""}. Shopee’s Ready to Ship report uses a different order group. All order counts here use the order creation date in WIB.</p>}
    <ReportingControls period={period}/>
    <div className="analytics-grid">
      <Card role="region" aria-label="Sales chart">{trend.length ? <OverviewTrend data={trend}/> : <><div className="card-heading"><h2>Sales over time</h2></div><EmptyState title="No sales in this period">Connect a shop or choose a different date range.</EmptyState></>}</Card>
      <Card className="status-card"><div className="card-heading"><div><h2>Order status</h2></div></div><div className="status-total"><span>{number(data.metrics.orders)}</span><p>orders placed</p></div><div className="status-bar"><i style={{ width: `${data.metrics.orders ? data.metrics.completed / data.metrics.orders * 100 : 0}%` }}/><b style={{ width: `${data.metrics.orders ? data.metrics.cancelled / data.metrics.orders * 100 : 0}%` }}/></div><div className="status-legend"><div><span><i className="dot dot-green"/>Completed</span><strong>{number(data.metrics.completed)}</strong></div><div><span><i className="dot dot-orange"/>In progress</span><strong>{number(data.metrics.orders - data.metrics.completed - data.metrics.cancelled)}</strong></div><div><span><i className="dot dot-red"/>Cancelled</span><strong>{number(data.metrics.cancelled)}</strong></div></div><p className="status-footnote">Cancelled orders stay visible in your history.</p></Card>
    </div>
    <CostBreakdown summary={data.costSummary} adSpend={adSpend} adsComplete={adsComplete}/>
    <div className="lower-grid">
      <Card className="orders-card"><div className="card-heading"><div><h2>Recent orders</h2></div><ReportLink href="/orders" className="text-link">View all <Icon name="arrow" size={14}/></ReportLink></div><OrderTable orders={data.orders.slice(0, 5)}/></Card>
      <Card className="product-ranking"><div className="card-heading"><div><h2>Top products</h2><p>By completed units in the selected period</p></div></div>{data.products.length ? topProducts.map((product, index) => <div className="rank-row" key={product.id}><span className="rank-number">0{index + 1}</span><div className="rank-detail"><strong>{product.name}</strong><span>{product.variants.length} {product.variants.length === 1 ? "variation" : "variations"}</span></div><strong className="rank-units">{product.units}<small>sold</small></strong></div>) : <EmptyState title="No completed product sales">Products appear here when completed orders fall within this period.</EmptyState>}<ReportLink href="/products" className="ranking-link">Manage product costs <Icon name="arrow" size={14}/></ReportLink></Card>
    </div>
    <div className="freshness"><span><Icon name="clock" size={14}/>{demo ? "Sample data for preview" : `Orders last synced: ${timeLabel(data.lastSyncedAt)}`}</span><span>Payouts last refreshed: {timeLabel(data.profitSummary?.lastSyncedAt ?? null)}</span></div>
  </>;
}