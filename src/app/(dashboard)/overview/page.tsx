import { ReportLink } from "@/components/report-link";
import { getDashboardData } from "@/server/dashboard";
import { rupiah, number, timeLabel } from "@/lib/format";
import { Card, EmptyState, PageHeading, Metric } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ReportChart } from "@/components/report-chart";
import { ReportingControls } from "@/components/reporting-controls";
import { pageReportPeriod, type ReportQuery } from "@/core/reporting-period";
import { OrderTable } from "@/components/order-table";
import { SyncButton, AutoSync } from "@/components/sync-button";

export default async function Overview({ searchParams }: { searchParams: Promise<ReportQuery> }) {
  const period = pageReportPeriod(await searchParams);
  const data = await getDashboardData(period);
  const demo = data.mode === "demo";
  const cards = [
    { label: "Completed sales", value: rupiah(data.metrics.sales), note: "Merchandise before refunds and fees", icon: "money" },
    { label: "Orders placed", value: number(data.metrics.orders), note: `${data.metrics.completed} completed / ${data.metrics.cancelled} cancelled`, icon: "orders" },
    { label: "Estimated contribution", value: rupiah(data.metrics.profit), note: "Waiting for settlement and cost data", icon: "products" },
    { label: "Confirmed refunds", value: rupiah(data.metrics.refunds), note: demo ? "Sample refunds updated in this period" : "Complete financial coverage is not verified", icon: "returns" },
  ];
  const topProducts = [...data.products].sort((a, b) => b.units - a.units).slice(0, 4);
  return <>
    <AutoSync shopId={data.shop?.id} enabled={!demo && data.shop?.status === "CONNECTED"} lastSyncedAt={data.lastSyncedAt}/>
    <PageHeading title="Overview" actions={<SyncButton shopId={data.shop?.id} disabled={demo || data.shop?.status !== "CONNECTED"}/>}/>
    <dl className="metrics-grid">{cards.map((card, index) => <Metric key={card.label} label={card.label} value={card.value} note={card.note} featured={index === 0}/>)}</dl>
    <ReportingControls period={period}/>
    <div className="analytics-grid">
      <Card role="region" aria-label="Sales chart"><div className="card-heading report-chart-heading"><div><h2>Sales over time</h2><p>Completed merchandise by order creation date / IDR</p></div></div>{data.trend.length ? <ReportChart data={data.trend} series={[{ key: "sales", label: "Completed sales", color: "var(--chart-primary)" }]} label="Completed sales over time"/> : <EmptyState title="No sales in this period">Connect a shop or choose a different date range.</EmptyState>}</Card>
      <Card className="status-card"><div className="card-heading"><div><h2>Order status</h2></div></div><div className="status-total"><span>{number(data.metrics.orders)}</span><p>orders placed</p></div><div className="status-bar"><i style={{ width: `${data.metrics.orders ? data.metrics.completed / data.metrics.orders * 100 : 0}%` }}/><b style={{ width: `${data.metrics.orders ? data.metrics.cancelled / data.metrics.orders * 100 : 0}%` }}/></div><div className="status-legend"><div><span><i className="dot dot-green"/>Completed</span><strong>{number(data.metrics.completed)}</strong></div><div><span><i className="dot dot-orange"/>In progress</span><strong>{number(data.metrics.orders - data.metrics.completed - data.metrics.cancelled)}</strong></div><div><span><i className="dot dot-red"/>Cancelled</span><strong>{number(data.metrics.cancelled)}</strong></div></div><p className="status-footnote">Cancelled orders stay visible in your history.</p></Card>
    </div>
    <div className="lower-grid">
      <Card className="orders-card"><div className="card-heading"><div><h2>Recent orders</h2></div><ReportLink href="/orders" className="text-link">View all <Icon name="arrow" size={14}/></ReportLink></div><OrderTable orders={data.orders.slice(0, 5)}/></Card>
      <Card className="product-ranking"><div className="card-heading"><div><h2>Top products</h2><p>By completed units in the selected period</p></div></div>{data.products.length ? topProducts.map((product, index) => <div className="rank-row" key={product.id}><span className="rank-number">0{index + 1}</span><div className="rank-detail"><strong>{product.name}</strong><span>{product.sku}</span></div><strong className="rank-units">{product.units}<small>sold</small></strong></div>) : <EmptyState title="No completed product sales">Products appear here when completed orders fall within this period.</EmptyState>}<ReportLink href="/products" className="ranking-link">Manage product costs <Icon name="arrow" size={14}/></ReportLink></Card>
    </div>
    <div className="freshness"><span><Icon name="clock" size={14}/>{demo ? "Sample data for preview" : `Orders last synced: ${timeLabel(data.lastSyncedAt)}`}</span><span>Returns and settlement coverage is not yet verified.</span></div>
  </>;
}