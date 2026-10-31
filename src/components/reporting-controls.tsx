"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { REPORT_KEYS, resolveReportPeriod, type ReportPeriod, type ReportQuery } from "@/core/reporting-period";
import { ReportDatePicker } from "./report-date-picker";
import { ReportIntervalControl } from "./report-interval";
import { Button } from "./ui/button";
import { RefreshCw } from "lucide-react";
import { useReportNavigation } from "./report-navigation";

export function ReportingControls({ period, children }: { period: ReportPeriod; children?: ReactNode }) {
  const { pending, update, getQuery, refresh } = useReportNavigation();
  const [error, setError] = useState("");
  useEffect(() => { setError(""); }, [period.from, period.to, period.preset, period.interval]);
  const navigate = useCallback((patch: Record<string, string>) => {
    setError("");
    const changes = period.error ? { interval: period.interval, tz: "", ...patch } : patch;
    const params = new URLSearchParams(getQuery());
    for (const key of REPORT_KEYS) if (key !== "interval" && key !== "tz") params.delete(key);
    for (const [key, value] of Object.entries(changes)) if (value) params.set(key, value); else params.delete(key);
    try { resolveReportPeriod(Object.fromEntries(params)); }
    catch { setError("This range needs a coarser interval. Change the interval beside the date picker, then try again."); return false; }
    update(changes, true);
    return true;
  }, [update, getQuery, period.error, period.interval]);
  return <section className="report-controls" aria-label="Reporting period" aria-busy={pending}>
    <div className="report-toolbar">
      <ReportDatePicker period={period} onSelect={navigate}/>
      {children}
      <ReportIntervalControl period={period}/>
      <Button variant="outline" size="icon-sm" onClick={() => { setError(""); void refresh().catch(() => setError("Could not refresh the report. Please try again.")); }} disabled={pending} aria-label="Refresh report" title="Refresh report"><RefreshCw className="size-4"/></Button>
    </div>
    <div className="report-resolved"><span data-testid="reporting-range">{period.label}</span><span role="status">{pending ? "Updating report..." : ""}</span></div>
    {(error || period.error) && <p className="report-error" role="alert">{error || period.error}</p>}
  </section>;
}

export function ReportHiddenFields({ query }: { query: ReportQuery }) {
  return <>{REPORT_KEYS.filter(key => typeof query[key] === "string").map(key => <input key={key} type="hidden" name={key} value={query[key] as string}/>)}</>;
}
