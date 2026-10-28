"use client";
import { useState } from "react";
import { ReportChart, type ReportChartPoint } from "./report-chart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

const views = {
  profit: { label: "Profit", unit: "IDR" as const },
  sales: { label: "Sales", unit: "IDR" as const },
  orders: { label: "Orders", unit: "count" as const },
  units: { label: "Units", unit: "count" as const },
};
const descriptions = {
  paid: {
    profit: { title: "Estimated clean profit", note: "Paid orders after COGS, Shopee deductions and ads; gaps indicate missing data", series: "Estimated clean profit", key: "profit" },
    sales: { title: "Sales over time", note: "Paid orders by order date, after confirmed refunds", series: "Sales", key: "sales" },
    orders: { title: "Orders over time", note: "Orders by order date; unpaid excluded, cancelled retained", series: "Orders", key: "orders" },
    units: { title: "Units sold over time", note: "Paid units by original order date", series: "Units", key: "units" },
  },
  completed: {
    profit: { title: "Clean profit over time", note: "Completed orders after COGS, Shopee deductions and ads; gaps indicate missing data", series: "Clean profit", key: "completedProfit" },
    sales: { title: "Completed sales over time", note: "Completed orders by order date, after confirmed refunds", series: "Completed sales", key: "completedSales" },
    orders: { title: "Completed orders over time", note: "Completed orders by original order date", series: "Completed orders", key: "completedOrders" },
    units: { title: "Completed units over time", note: "Completed units by original order date", series: "Completed units", key: "completedUnits" },
  },
};

export function OverviewTrend({ data }: { data: ReportChartPoint[] }) {
  const [view, setView] = useState<keyof typeof views>("sales");
  const [scope, setScope] = useState<keyof typeof descriptions>("paid");
  const selected = descriptions[scope][view];
  return <Tabs value={view} onValueChange={value => setView(value as keyof typeof views)} className="gap-0">
    <div className="card-heading report-chart-heading">
      <div><h2>{selected.title}</h2><p>{selected.note}</p></div>
      <div className="overview-chart-controls">
        <label className="overview-order-scope"><span>Order scope</span><NativeSelect aria-label="Order scope" value={scope} onChange={event => setScope(event.target.value as keyof typeof descriptions)} className="h-8 text-[11px]">
          <NativeSelectOption value="paid">Sales (paid orders)</NativeSelectOption>
          <NativeSelectOption value="completed">Completed sales</NativeSelectOption>
        </NativeSelect></label>
        <TabsList className="h-8 bg-muted/70">{Object.entries(views).map(([key, value]) => <TabsTrigger key={key} value={key} className="px-3 text-[11px]">{value.label}</TabsTrigger>)}</TabsList>
      </div>
    </div>
    <TabsContent value={view} className="mt-0"><ReportChart data={data} series={[{ key: selected.key, label: selected.series, color: "var(--chart-primary)" }]} unit={views[view].unit} label={selected.series + " over time"}/></TabsContent>
  </Tabs>;
}
