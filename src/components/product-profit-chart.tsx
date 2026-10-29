"use client";

import { productProfitContributions, type ProductAdSpend, type ProductProfitBase } from "@/core/product-profit";
import { rupiah } from "@/lib/format";
import { Card, EmptyState } from "@/components/ui";
import { ProfitDonut, percentage } from "@/components/profit-donut";

const palette = ["var(--chart-primary)", "var(--color-blue-500)", "var(--color-violet-500)", "var(--color-amber-500)", "var(--color-cyan-500)", "var(--color-rose-500)", "var(--color-teal-500)", "var(--color-orange-500)"];

export function ProductProfitChart({ base, ads, names, adsComplete }: { base?: ProductProfitBase; ads?: ProductAdSpend; names: { sourceItemId: string; name: string }[]; adsComplete: boolean }) {
  const data = base && ads ? productProfitContributions(base, ads, names) : null;
  const ready = adsComplete && data !== null && (base!.covered > 0 || base!.eligible === 0);
  const rows = data?.products.map((row, index) => ({
    ...row, color: palette[index % palette.length],
    key: row.itemId, label: row.name, value: Number(row.cleanProfit),
    detail: Number(row.adSpend) > 0 ? `Before ads ${rupiah(Number(row.profitBeforeAds))} � Ads incl. PPN -${rupiah(Number(row.adSpend))}` : "No matched product ad spend",
  })) ?? [];
  const slices = rows.filter(row => row.value > 0);
  const positiveBasis = data && (data.hasLosses || Number(data.unassignedSpend) > 0);
  const notes = [
    data?.partial ? `${base!.covered} / ${base!.eligible} completed orders covered.` : null,
    data?.mixedOrders ? "Mixed-order payouts are split by item sales value." : null,
    data && Number(data.unassignedSpend) > 0 ? `${rupiah(Number(data.unassignedSpend))} in shared or unmatched ads (incl. PPN) is deducted from the total, not individual products.` : null,
    positiveBasis ? "Percentages show shares of positive product profit; losses are listed separately." : null,
  ].filter(Boolean);
  return <Card role="region" aria-label="Product clean profit" className="profit-card">
    <div className="card-heading"><h2>Clean profit by product</h2><span className="text-[10px] text-muted-foreground">After ads &amp; PPN</span></div>
    {ready && rows.length ? <div className="profit-card-body">
      {slices.length ? <ProfitDonut slices={slices} label="Product clean profit contribution pie chart">
        <span>{Number(data!.total) < 0 ? "Net loss" : "Clean profit"}</span>
        <strong className={Number(data!.total) < 0 ? "text-destructive" : "text-primary"}>{rupiah(Number(data!.total))}</strong>
        <small>{rows.length} products</small>
      </ProfitDonut> : <div className="profit-no-slices"><span>Net loss</span><strong>{rupiah(Number(data!.total))}</strong><small>No positive product profit</small></div>}
      <div className="profit-ledger" tabIndex={0} aria-label="Product profit amounts and percentages">
        <ul>{rows.map(row => <li key={row.itemId} className={row.value < 0 ? "profit-loss" : ""}>
          <span className="profit-ledger-label" title={row.name}><i style={{ background: row.color }}/><span>{row.name}</span></span>
          <strong>{rupiah(row.value)}</strong><small>{row.value < 0 ? "Loss" : percentage(row.percentage)}</small>
        </li>)}</ul>
      </div>
    </div> : <EmptyState title={ready ? "No product profit yet" : "Waiting for profit data"}>{ready ? "Completed orders with payouts and product costs appear here." : "Complete ad spend and completed-order payouts are needed to calculate product clean profit."}</EmptyState>}
    {ready && notes.length > 0 && <p className="profit-card-note">{notes.join(" ")}</p>}
  </Card>;
}
