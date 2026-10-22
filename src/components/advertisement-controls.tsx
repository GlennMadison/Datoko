"use client";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useReportNavigation } from "./report-navigation";
import { Button } from "./ui";

export function AdvertisementFilters({ datasets, dataset, campaigns, campaign }: { datasets: { key: string; name: string }[]; dataset: string | null; campaigns: { key: string; name: string }[]; campaign: string }) {
  const { pending, update } = useReportNavigation();
  return <div className="ad-filters"><label className="report-field">Source report <select aria-label="Source report" disabled={!datasets.length || pending} value={dataset ?? ""} onChange={event => update({ dataset: event.target.value, campaign: "" })}>{!datasets.length && <option value="">No reports imported</option>}{datasets.map(row => <option key={row.key} value={row.key}>{row.name}</option>)}</select></label><label className="report-field">Campaign <select aria-label="Ad campaign" disabled={!campaigns.length || pending} value={campaign} onChange={event => update({ campaign: event.target.value })}>{campaigns.map(row => <option key={row.key} value={row.key}>{row.name}</option>)}</select></label></div>;
}

const messages: Record<string, string> = {
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
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setMessage(`${result.imported} reporting periods imported; ${result.unchanged} unchanged.`);
      if (new URLSearchParams(getQuery()).get("dataset") !== result.datasetKey) update({ dataset: result.datasetKey, campaign: "" }); else refresh();
      form.reset();
    } catch { setMessage("Import failed. Your saved report was not replaced by a partial import."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="ad-import"><label htmlFor="ad-report-file">Normalized ad report (.json)</label><div><input id="ad-report-file" name="report" type="file" accept="application/json,.json" disabled={disabled || busy} required/><Button disabled={disabled || busy}>{busy ? "Importing…" : "Import report"}</Button>{!disabled && <><a className="text-link" href="/api/advertisement/template">Download format</a><a className="text-link" href={`/api/advertisement/order-items?${currentQuery}`}>Download order item references</a></>}</div><p>Use a report with explicit ad-attributed items and outcomes. Aggregate totals alone provide Original ROAS. Importing a report does not change Shopee ads.</p>{message && <p role="status">{message}</p>}</form>;
}
