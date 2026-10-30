"use client";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useId, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export type ReportChartPoint = { date: string; [key: string]: string | number | null };
export function ReportChart({ data, series, unit = "IDR", label }: { data: ReportChartPoint[]; series: { key: string; label: string; color: string }[]; unit?: "IDR" | "ROAS" | "count"; label: string }) {
  const [showData, setShowData] = useState(false);
  const gradientId = "chart-" + useId().replaceAll(":", "");
  const format = (value: unknown) => value === null ? "Unavailable" : unit === "ROAS" ? Number(value).toFixed(2) + "x" : unit === "IDR" ? new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value)) : new Intl.NumberFormat("en-US").format(Number(value));
  const axisFormat = (value: number) => unit === "ROAS" ? value + "x" : unit === "IDR" ? Number(value) / 1000 + "k" : new Intl.NumberFormat("en-US", { notation: "compact" }).format(value);
  return <>
    <div className="report-chart" role="img" aria-label={label + ". " + (unit === "IDR" ? "Values in IDR; axis in thousands." : unit === "ROAS" ? "Revenue per unit of ad spend." : "Number of items.") + " Exact values are available in View chart data."}>
      <ResponsiveContainer width="100%" height={312}><ComposedChart data={data} margin={{ left: 0, right: 20, top: 16, bottom: 4 }}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={series[0]?.color} stopOpacity={0.17}/><stop offset="95%" stopColor={series[0]?.color} stopOpacity={0.01}/></linearGradient></defs>
        <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 6"/>
        <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={40} tickMargin={12} tick={{ fill: "var(--muted)", fontSize: 12 }}/>
        <YAxis axisLine={false} tickLine={false} width={68} allowDecimals={unit !== "count"} tickMargin={8} tick={{ fill: "var(--muted)", fontSize: 12 }} tickFormatter={axisFormat}/>
        <Tooltip labelStyle={{ color: "var(--ink)", marginBottom: 6, fontWeight: 500 }} cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }} formatter={value => format(value)} contentStyle={{ backgroundColor: "var(--surface)", color: "var(--ink)", borderRadius: 10, borderColor: "var(--line)", padding: "12px 16px", fontSize: 11, boxShadow: "0 8px 24px var(--shadow)" }}/>
        {series.length > 1 && <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 11, paddingTop: 12 }}/>}
        {series.map((value, index) => index === 0 && series.length === 1
          ? <Area key={value.key} dataKey={value.key} name={value.label} type="linear" stroke={value.color} strokeWidth={2} fill={"url(#" + gradientId + ")"} dot={data.length === 1 ? { r: 3 } : false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 3 }} isAnimationActive={false} connectNulls={false}/>
          : <Line key={value.key} dataKey={value.key} name={value.label} type="linear" stroke={value.color} strokeWidth={2} strokeDasharray={index === 0 ? "5 4" : undefined} dot={data.length <= 31 ? { r: 2 } : false} isAnimationActive={false} connectNulls={false}/>)}
      </ComposedChart></ResponsiveContainer>
    </div>
    <details className="chart-data" onToggle={event => setShowData(event.currentTarget.open)}><summary>View chart data</summary>{showData && <><div className="table-scroll" tabIndex={0}><Table><caption className="sr-only">{label}</caption><TableHeader><TableRow><TableHead>Date / WIB</TableHead>{series.map(value => <TableHead key={value.key} className="text-right">{value.label}{unit === "IDR" ? " / IDR" : ""}</TableHead>)}</TableRow></TableHeader><TableBody>{data.slice(0, 200).map((point, index) => <TableRow key={point.date + "-" + index}><TableCell>{point.date}</TableCell>{series.map(value => <TableCell key={value.key} className="text-right">{format(point[value.key])}</TableCell>)}</TableRow>)}</TableBody></Table></div>{data.length > 200 && <p>Showing the first 200 of {data.length} intervals. The chart includes all intervals.</p>}</>}</details>
  </>;
}
