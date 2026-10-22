"use client";
import { useEffect, useId, useState } from "react";
import { resolveReportPeriod, type ReportPeriod } from "@/core/reporting-period";
import { useReportNavigation } from "./report-navigation";

const intervals = [["auto", "Auto"], ["hour", "1 hour"], ["3hour", "3 hours"], ["6hour", "6 hours"], ["12hour", "12 hours"], ["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"]];

export function ReportIntervalControl({ period }: { period: ReportPeriod }) {
  const { pending, update, getQuery } = useReportNavigation();
  const [error, setError] = useState("");
  const errorId = useId();
  useEffect(() => { setError(""); }, [period.from, period.to, period.interval]);
  function selectInterval(interval: string) {
    const changes: Record<string, string> = period.error ? { preset: "custom", from: period.from, to: period.to, interval, tz: "" } : { interval };
    const params = new URLSearchParams(period.error ? "" : getQuery());
    for (const [key, value] of Object.entries(changes)) if (value) params.set(key, value); else params.delete(key);
    try { resolveReportPeriod(Object.fromEntries(params)); }
    catch { setError("Choose a coarser interval for this date range."); return; }
    setError("");
    update(changes, Boolean(period.error));
  }
  return <div className="graph-interval" aria-busy={pending}>
    <label>Interval <select aria-label="Graph interval" value={period.interval} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} onChange={event => selectInterval(event.target.value)}>
      {intervals.map(([value, label]) => <option key={value} value={value}>{value === "auto" ? `Auto (${intervals.find(([key]) => key === period.effectiveInterval)?.[1] ?? "Daily"})` : label}</option>)}
    </select></label>
    {error && <p id={errorId} className="report-error" role="alert">{error}</p>}
  </div>;
}
