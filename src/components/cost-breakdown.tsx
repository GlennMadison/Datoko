"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { costBreakdown, type CostSummary } from "@/core/cost-breakdown";
import { rupiah } from "@/lib/format";
import { Card, EmptyState } from "@/components/ui";

const colors: Record<string, string> = {
  cogs: "var(--color-slate-500)", ads: "var(--color-amber-500)", affiliate: "var(--color-violet-500)",
  commission: "var(--chart-primary)", service: "var(--color-blue-500)", transaction: "var(--color-cyan-500)",
  refunds: "var(--color-rose-500)", other: "var(--color-stone-500)",
};
const extraColors = ["var(--color-orange-500)", "var(--color-lime-600)", "var(--color-fuchsia-500)", "var(--color-indigo-500)", "var(--color-teal-500)"];
const percentage = (value: number | null) => value === null ? "Unavailable" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value) + "%";
const emptySummary: CostSummary = { items: [], sales: "0", covered: 0, eligible: 0, estimated: 0, groupedFees: 0 };

export function CostBreakdown({ summary = emptySummary, adSpend, adsComplete }: { summary?: CostSummary; adSpend: string | null; adsComplete: boolean }) {
  const data = costBreakdown(summary, adSpend);
  const slices = data.slices.map((item, index) => ({ ...item, color: colors[item.key] ?? extraColors[index % extraColors.length] }));
  const partial = summary.covered < summary.eligible || !adsComplete;
  return <Card role="region" aria-label="Cost breakdown" className="mb-5">
    <div className="card-heading"><div><h2>Cost breakdown</h2><p>Share of recorded costs in the selected period{partial ? " � partial data" : ""}</p></div></div>
    {slices.length ? <div className="grid min-w-0 items-center gap-5 px-5 pb-5 md:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.5fr)]">
      <div className="relative min-w-0">
        <div role="img" aria-label="Cost breakdown pie chart. Exact amounts and percentages follow in the cost list.">
          <ResponsiveContainer width="100%" height={260} minWidth={0}>
            <PieChart accessibilityLayer>
              <Pie data={slices} dataKey="value" nameKey="label" innerRadius={82} outerRadius={112} paddingAngle={slices.length > 1 ? 2 : 0} stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>
                {slices.map(item => <Cell key={item.key} fill={item.color}/>)}
              </Pie>
              <Tooltip formatter={value => rupiah(Number(value))} contentStyle={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--border)", borderRadius: 10, fontSize: 12 }} itemStyle={{ color: "var(--foreground)" }}/>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-center" aria-hidden="true">
          <span className="text-[11px] text-muted-foreground">Recorded costs</span>
          <strong className="numeric text-lg font-semibold tracking-tight">{rupiah(Number(data.total))}</strong>
          {data.salesPercentage !== null && <span className="text-[10px] text-muted-foreground">{percentage(data.salesPercentage)} of covered sales</span>}
        </div>
        <p className="sr-only">Recorded costs: {rupiah(Number(data.total))}. {data.salesPercentage !== null ? `${percentage(data.salesPercentage)} of covered sales.` : "Sales percentage unavailable."}</p>
      </div>
      <div className="min-w-0">
        <ul aria-label="Cost amounts and percentages" className="divide-y divide-border/60">
          {slices.map(item => <li key={item.key} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className="flex min-w-0 items-center gap-2.5 text-xs"><i aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }}/><span>{item.label}</span></span>
            <span className="shrink-0 text-right"><strong className="numeric block text-xs font-medium">{rupiah(item.value)}</strong><span className="block text-[10px] leading-relaxed text-muted-foreground">{percentage(item.percentage)} of costs{item.salesPercentage !== null ? ` � ${percentage(item.salesPercentage)} of sales` : ""}</span></span>
          </li>)}
        </ul>
      </div>
    </div> : <EmptyState title="No recorded costs">Costs appear after completed orders have payouts and COGS, or ad spend is synced.</EmptyState>}
    <div className="border-t border-border/60 px-5 py-3 text-[11px] leading-relaxed text-muted-foreground">
      <p>{summary.covered} / {summary.eligible} completed orders with payouts and COGS. Ad spend uses the selected date range.{summary.estimated > 0 ? ` ${summary.estimated} orders use estimated COGS.` : ""}</p>
      <details className="mt-1.5"><summary className="w-fit cursor-pointer text-foreground">Data notes</summary><div className="mt-2 space-y-1">
        {summary.covered < summary.eligible && <p>Orders missing payouts or COGS are excluded. Sales percentages use only the covered completed orders.</p>}
        {!adsComplete && <p>{adSpend === null ? "Advertising spend is awaiting sync and is not included yet." : "Advertising coverage is incomplete; only synced spend is included."}</p>}
        {summary.groupedFees > 0 && <p>Some older payouts group smaller fees under Other Shopee fees. Refresh payouts to load the individual fees where Shopee provides them.</p>}
        {data.credits.length > 0 && <p>Fee credits are shown separately from pie slices: {data.credits.map(item => `${item.label} ${rupiah(Number(item.amount))}`).join(", ")}.</p>}
        <p>Service fees stay combined when Shopee returns one amount. Unitemized payout adjustments are not assigned to fee slices.</p>
      </div></details>
    </div>
  </Card>;
}
