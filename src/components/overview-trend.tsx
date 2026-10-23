"use client";
import { useState } from "react";
import { ReportChart, type ReportChartPoint } from "./report-chart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
const views = {
  sales: { label: "Sales", title: "Sales over time", note: "Completed merchandise by order creation date · IDR", seriesLabel: "Completed sales", unit: "IDR" as const },
  orders: { label: "Orders", title: "Orders over time", note: "Orders placed by creation date", seriesLabel: "Orders", unit: "count" as const },
  units: { label: "Units", title: "Units sold over time", note: "Completed units by original order date", seriesLabel: "Completed units", unit: "count" as const },
};
export function OverviewTrend({ data }: { data: ReportChartPoint[] }) {
  const [view, setView] = useState<keyof typeof views>("sales");
  const selected = views[view];
  return <Tabs value={view} onValueChange={value => setView(value as keyof typeof views)} className="gap-0">
    <div className="card-heading report-chart-heading"><div><h2>{selected.title}</h2><p>{selected.note}</p></div><TabsList className="h-8 bg-muted/70">{Object.entries(views).map(([key, value]) => <TabsTrigger key={key} value={key} className="px-3 text-[11px]">{value.label}</TabsTrigger>)}</TabsList></div>
    <TabsContent value={view} className="mt-0"><ReportChart data={data} series={[{ key: view, label: selected.seriesLabel, color: "var(--chart-primary)" }]} unit={selected.unit} label={selected.seriesLabel + " over time"}/></TabsContent>
  </Tabs>;
}
