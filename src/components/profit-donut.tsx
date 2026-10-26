"use client";

import type { ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { rupiah } from "@/lib/format";

export type DonutSlice = { key: string; label: string; value: number; color: string; percentage: number | null; detail?: string };
export const percentage = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value) + "%";

export function ProfitDonut({ slices, label, children }: { slices: DonutSlice[]; label: string; children: ReactNode }) {
  return <div className="profit-donut" role="group" aria-label={label}>
    <div className="profit-donut-center">{children}</div>
    {/* The entire chart/tooltip layer is above the center, including Recharts' nested wrapper. */}
    <div className="profit-donut-chart">
      <ResponsiveContainer width="100%" height={200} minWidth={0}>
        <PieChart accessibilityLayer>
          <Pie data={slices} dataKey="value" nameKey="label" innerRadius={62} outerRadius={88} paddingAngle={slices.length > 1 ? 2 : 0} stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>
            {slices.map(slice => <Cell key={slice.key} fill={slice.color}/>)}
          </Pie>
          <Tooltip wrapperStyle={{ zIndex: 50, pointerEvents: "none" }} isAnimationActive={false} content={({ active, payload }) => {
            const slice = payload?.[0]?.payload as DonutSlice | undefined;
            if (!active || !slice) return null;
            return <div className="profit-tooltip" role="tooltip"><strong>{slice.label}</strong><span>{rupiah(slice.value)} <b>{percentage(slice.percentage)}</b></span>{slice.detail && <small>{slice.detail}</small>}</div>;
          }}/>
        </PieChart>
      </ResponsiveContainer>
    </div>
  </div>;
}
