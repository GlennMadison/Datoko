"use client";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useState } from "react";

export type ReportChartPoint = { date: string; [key: string]: string | number | null };
export function ReportChart({ data, series, unit = "IDR", label }: { data: ReportChartPoint[]; series: { key: string; label: string; color: string }[]; unit?: "IDR" | "ROAS" | "count"; label: string }) {
  const [showData, setShowData] = useState(false);
  const format = (value: unknown) => value === null ? "Unavailable" : unit === "ROAS" ? `${Number(value).toFixed(2)}x` : unit === "IDR" ? new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value)) : new Intl.NumberFormat("en-US").format(Number(value));
  const axisFormat = (value: number) => unit === "ROAS" ? `${value}x` : unit === "IDR" ? `${Number(value) / 1000}k` : new Intl.NumberFormat("en-US", { notation: "compact" }).format(value);
  return <>
    <div className="report-chart" role="img" aria-label={`${label}. ${unit === "IDR" ? "Values in IDR; axis in thousands." : unit === "ROAS" ? "Revenue per unit of ad spend." : "Number of items."} Exact values are available in View chart data.`}>
      <ResponsiveContainer width="100%" height={260}><ComposedChart data={data} margin={{ left: 5, right: 16, top: 12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#e9ede9"/>
        <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={35} tick={{ fill: "#65716b", fontSize: 11 }}/>
        <YAxis axisLine={false} tickLine={false} width={65} allowDecimals={unit !== "count"} tick={{ fill: "#65716b", fontSize: 11 }} tickFormatter={axisFormat}/>
        <Tooltip formatter={value => format(value)} contentStyle={{ borderRadius: 6, borderColor: "#d9e1da", fontSize: 12, boxShadow: "0 3px 12px #203c2810" }}/>
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }}/ >}
        {series.map((value, index) => index === 0 && series.length === 1
          ? <Area key={value.key} dataKey={value.key} name={value.label} type="linear" stroke={value.color} strokeWidth={2} fill={value.color} fillOpacity={0.06} dot={data.length === 1 ? { r: 3 } : false} isAnimationActive={false} connectNulls={false}/>
          : <Line key={value.key} dataKey={value.key} name={value.label} type="linear" stroke={value.color} strokeWidth={2} strokeDasharray={index === 0 ? "5 4" : undefined} dot={data.length <= 31 ? { r: 2 } : false} isAnimationActive={false} connectNulls={false}/>)}
      </ComposedChart></ResponsiveContainer>
    </div>
    <details className="chart-data" onToggle={event => setShowData(event.currentTarget.open)}><summary>View chart data</summary>{showData && <><div className="table-scroll" tabIndex={0}><table><caption className="sr-only">{label}</caption><thead><tr><th>Date / WIB</th>{series.map(value => <th key={value.key} className="text-right">{value.label}{unit === "IDR" ? " / IDR" : ""}</th>)}</tr></thead><tbody>{data.slice(0, 200).map((point, index) => <tr key={`${point.date}-${index}`}><td>{point.date}</td>{series.map(value => <td key={value.key} className="text-right">{format(point[value.key])}</td>)}</tr>)}</tbody></table></div>{data.length > 200 && <p>Showing the first 200 of {data.length} intervals. The chart includes all intervals.</p>}</>}</details>
  </>;
}
