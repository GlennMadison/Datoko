"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { costBreakdown, type CostSummary } from "@/core/cost-breakdown";
import { rupiah } from "@/lib/format";
import { Card, EmptyState } from "@/components/ui";

const colors: Record<string, string> = {
  profit: "var(--chart-primary)", cogs: "var(--color-slate-500)", ads: "var(--color-amber-500)", affiliate: "var(--color-violet-500)",
  commission: "var(--color-teal-500)", service: "var(--color-blue-500)", transaction: "var(--color-cyan-500)",
  refunds: "var(--color-rose-500)", other: "var(--color-stone-500)", other_deductions: "var(--color-stone-500)",
};
const extraColors = ["var(--color-orange-500)", "var(--color-lime-600)", "var(--color-fuchsia-500)", "var(--color-indigo-500)", "var(--color-teal-500)"];
const percentage = (value: number | null) => value === null ? "Unavailable" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value) + "%";
const emptySummary: CostSummary = { items: [], sales: "0", profit: null, covered: 0, eligible: 0, estimated: 0, groupedFees: 0 };

export function CostBreakdown({ summary = emptySummary, adSpend, adsComplete }: { summary?: CostSummary; adSpend: string | null; adsComplete: boolean }) {
  const data = costBreakdown(summary, adSpend, adsComplete);
  const slices = data.slices.map((item, index) => ({ ...item, color: colors[item.key] ?? extraColors[index % extraColors.length] }));
  const chartSlices = slices.filter(item => item.value > 0);
  const partial = summary.covered < summary.eligible || !adsComplete;
  const loss = data.cleanProfit !== null && Number(data.cleanProfit) < 0;
  const shareBasis = Number(data.chartTotal) === Number(summary.sales) ? "sales" : "total";
  return <Card role="region" aria-label="Cost breakdown" className="mb-5">
    <div className="card-heading"><div><h2>Costs &amp; clean profit</h2><p>Selected period{partial ? " / partial data" : ""}</p></div></div>
    {chartSlices.length > 0 ? <div className="grid min-w-0 items-center gap-5 px-5 pb-5 md:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.5fr)]">
      <div className="relative isolate min-w-0">
        <div role="img" aria-label="Costs and clean profit pie chart. Exact amounts and percentages follow in the list.">
          <ResponsiveContainer width="100%" height={260} minWidth={0}>
            <PieChart accessibilityLayer>
              <Pie data={chartSlices} dataKey="value" nameKey="label" innerRadius={82} outerRadius={112} paddingAngle={chartSlices.length > 1 ? 2 : 0} stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>
                {chartSlices.map(item => <Cell key={item.key} fill={item.color}/>)}
              </Pie>
              <Tooltip wrapperStyle={{ zIndex: 20 }} formatter={value => rupiah(Number(value))} contentStyle={{ background: "var(--card)", color: "var(--foreground)", borderColor: "var(--border)", borderRadius: 10, fontSize: 12 }} itemStyle={{ color: "var(--foreground)" }}/>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 text-center" aria-hidden="true">
          <span className="text-[11px] text-muted-foreground">{loss ? "Net loss" : "Clean profit"}</span>
          <strong className={"numeric text-lg font-semibold tracking-tight " + (loss ? "text-destructive" : "text-primary")}>{rupiah(data.cleanProfit === null ? null : Number(data.cleanProfit))}</strong>
          <span className="text-[10px] text-muted-foreground">{data.profitPercentage === null ? "Awaiting complete data" : percentage(data.profitPercentage) + " of sales"}</span>
        </div>
        <p className="sr-only">{loss ? "Net loss" : "Clean profit"}: {rupiah(data.cleanProfit === null ? null : Number(data.cleanProfit))}. {data.profitPercentage === null ? "Profit percentage unavailable." : percentage(data.profitPercentage) + " of sales."}</p>
      </div>
      <div className="min-w-0">
        <ul aria-label="Amounts and percentages" className="divide-y divide-border/60">
          {slices.map(item => <li key={item.key} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className="flex min-w-0 items-center gap-2.5 text-xs"><i aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }}/><span className={item.key === "profit" ? "font-semibold text-primary" : ""}>{item.label}</span></span>
            <span className="shrink-0 text-right"><strong className="numeric block text-xs font-medium">{rupiah(item.value)}</strong><span className="block text-[10px] leading-relaxed text-muted-foreground">{percentage(item.percentage)} of {shareBasis}</span></span>
          </li>)}
        </ul>
      </div>
    </div> : <EmptyState title="No recorded costs">Costs appear after completed orders have payouts and COGS, or ad spend is synced.</EmptyState>}
    <p className="border-t border-border/60 px-5 py-3 text-[11px] leading-relaxed text-muted-foreground">{summary.covered} / {summary.eligible} completed orders covered.{summary.estimated > 0 ? ` ${summary.estimated} use estimated COGS.` : ""}{Number(data.otherIncome) > 0 ? ` Includes ${rupiah(Number(data.otherIncome))} in credits and other income.` : ""}{!adsComplete ? " Ad spend is incomplete." : ""}</p>
  </Card>;
}
