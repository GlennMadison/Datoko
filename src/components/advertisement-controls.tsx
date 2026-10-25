"use client";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useReportNavigation } from "./report-navigation";
import { Button } from "./ui";

export function AdvertisementFilters({ datasets, dataset, campaigns, campaign }: { datasets: { key: string; name: string }[]; dataset: string | null; campaigns: { key: string; name: string }[]; campaign: string }) {
  const { pending, update } = useReportNavigation();
  return <div className="ad-filters"><label className="report-field">Source report <NativeSelect aria-label="Source report" disabled={!datasets.length || pending} value={dataset ?? ""} onChange={event => update({ dataset: event.target.value, campaign: "" })}>{!datasets.length && <NativeSelectOption value="">No reports imported</NativeSelectOption>}{datasets.map(row => <NativeSelectOption key={row.key} value={row.key}>{row.name}</NativeSelectOption>)}</NativeSelect></label><label className="report-field">Campaign <NativeSelect aria-label="Ad campaign" disabled={!campaigns.length || pending} value={campaign} onChange={event => update({ campaign: event.target.value })}>{campaigns.map(row => <NativeSelectOption key={row.key} value={row.key}>{row.name}</NativeSelectOption>)}</NativeSelect></label></div>;
}

const messages: Record<string, string> = {
  RESERVED_ADS_DATASET: "This report key is reserved for automatic Shopee sync. Use a separate key for an uploaded report.",
  INVALID_AD_REPORT: "The file does not match the report format.", ATTRIBUTION_TOTAL_MISMATCH: "Attributed item amounts do not reconcile with the report revenue.",
  DUPLICATE_ATTRIBUTION: "The report repeats an attribution. Check the source conversion keys.", STALE_ADS_REVISION: "An equal or newer report is already stored. Use its latest source timestamp.",
  WRONG_ADS_ENVIRONMENT: "This report belongs to another Shopee environment.", SHOP_NOT_FOUND: "The report's shop is not connected to this workspace.",
  ADS_IMPORT_TOO_LARGE: "Choose a JSON file smaller than 2 MiB.", ADS_BASIS_CHANGED: "Use a different source report key when changing the attribution basis.",
  INVALID_ADS_PERIOD: "Check reporting times: buckets must use complete WIB days or aligned hours, with a valid source timestamp.",
};
export function AdvertisementImport({ disabled }: { disabled: boolean }) {
  const currentQuery = useSearchParams().toString();
  const { update, getQuery, refresh } = useReportNavigation();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || busy) return;
    setFailed(true);
    const form = event.currentTarget;
    const file = new FormData(form).get("report");
    if (!(file instanceof File) || !file.size) { setMessage("Choose a normalized JSON report."); return; }
    if (file.size > 2 * 1024 * 1024) { setMessage(messages.ADS_IMPORT_TOO_LARGE); return; }
    setBusy(true); setMessage("");
    try {
      const body = await file.text();
      try { JSON.parse(body); } catch { setMessage("Choose a valid JSON report."); return; }
      const response = await fetch("/api/advertisement/import", { method: "POST", headers: { "Content-Type": "application/json" }, body });
      const result = await response.json();
      if (!response.ok) { setMessage(messages[result.error] ?? "The report could not be imported. Check your sign-in and report format."); return; }
      setFailed(false);
      setMessage(`${result.imported} reporting periods imported; ${result.unchanged} unchanged.`);
      if (new URLSearchParams(getQuery()).get("dataset") !== result.datasetKey) update({ dataset: result.datasetKey, campaign: "" }); else refresh();
      form.reset();
    } catch { setMessage("Import failed. Your saved report was not replaced by a partial import."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="ad-import" aria-busy={busy}><label htmlFor="ad-report-file">Normalized ad report (.json)</label><div><Input id="ad-report-file" name="report" type="file" accept="application/json,.json" aria-describedby="ad-report-help" disabled={disabled || busy} required/><Button disabled={disabled || busy}>{busy ? "Importing…" : "Import report"}</Button>{!disabled && <><a className="text-link" href="/api/advertisement/template">Download format</a><a className="text-link" href={`/api/advertisement/order-items?${currentQuery}`}>Download order item references</a></>}</div><p id="ad-report-help">JSON, up to 2 MiB. Include attributed items and outcomes to calculate Real ROAS. Aggregate totals provide Original ROAS only. This import does not change your Shopee ads.</p>{disabled && <p>Report imports are disabled in demo mode.</p>}{message && <p className={failed ? "report-error" : undefined} role={failed ? "alert" : "status"}>{message}</p>}</form>;
}
