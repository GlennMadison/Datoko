"use client";

import { costBreakdown, type CostSummary } from "@/core/cost-breakdown";
import { rupiah } from "@/lib/format";
import { Card, EmptyState } from "@/components/ui";
import { ProfitDonut, percentage } from "@/components/profit-donut";

const colors: Record<string, string> = {
  profit: "var(--chart-primary)", cogs: "var(--color-slate-500)", ads: "var(--color-amber-500)", ads_ppn: "var(--color-orange-500)", affiliate: "var(--color-violet-500)",
  commission: "var(--color-teal-500)", service: "var(--color-blue-500)", transaction: "var(--color-cyan-500)",
  refunds: "var(--color-rose-500)", other: "var(--color-stone-500)", other_deductions: "var(--color-stone-500)",
};
const extraColors = ["var(--color-orange-500)", "var(--color-lime-600)", "var(--color-fuchsia-500)", "var(--color-indigo-500)"];
const emptySummary: CostSummary = { items: [], sales: "0", profit: null, covered: 0, eligible: 0, estimated: 0, groupedFees: 0 };

export function CostBreakdown({ summary = emptySummary, adSpend, adsComplete }: { summary?: CostSummary; adSpend: string | null; adsComplete: boolean }) {
  const data = costBreakdown(summary, adSpend, adsComplete);
  const slices = data.slices.map((item, index) => ({ ...item, color: colors[item.key] ?? extraColors[index % extraColors.length] }));
  const chartSlices = slices.filter(item => item.value > 0);
  const partial = summary.covered < summary.eligible || !adsComplete;
  const loss = data.cleanProfit !== null && Number(data.cleanProfit) < 0;
  const notes = [partial ? `${summary.covered} / ${summary.eligible} completed orders covered.` : null, summary.estimated ? "Includes estimated COGS." : null, !adsComplete ? "Ad spend is incomplete." : null, Number(data.otherIncome) > 0 ? `Includes ${rupiah(Number(data.otherIncome))} in credits and other income.` : null].filter(Boolean);
  return <Card role="region" aria-label="Cost breakdown" className="profit-card">
    <div className="card-heading"><h2>Costs &amp; clean profit</h2>{partial && <span className="text-[10px] text-muted-foreground">Partial data</span>}</div>
    {chartSlices.length ? <div className="profit-card-body">
      <ProfitDonut slices={chartSlices} label="Costs and clean profit pie chart">
        <span>{loss ? "Net loss" : "Clean profit"}</span>
        <strong className={loss ? "text-destructive" : "text-primary"}>{rupiah(data.cleanProfit === null ? null : Number(data.cleanProfit))}</strong>
        <small>{data.profitPercentage === null ? "Awaiting data" : percentage(data.profitPercentage) + " of sales"}</small>
      </ProfitDonut>
      <div className="profit-ledger" tabIndex={0} aria-label="Cost amounts and percentages">
        <ul>{slices.map(item => <li key={item.key}>
          <span className="profit-ledger-label"><i style={{ background: item.color }}/><span className={item.key === "profit" ? "font-semibold text-primary" : ""}>{item.label}</span></span>
          <strong>{rupiah(item.value)}</strong><small>{percentage(item.percentage)}</small>
        </li>)}</ul>
      </div>
    </div> : <EmptyState title="No recorded costs">Costs appear after completed orders have payouts and COGS, or ad spend is synced.</EmptyState>}
    {notes.length > 0 && <p className="profit-card-note">{notes.join(" ")}</p>}
  </Card>;
}
