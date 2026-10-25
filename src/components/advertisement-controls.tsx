"use client";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

import { useReportNavigation } from "./report-navigation";

export function AdvertisementFilters({ datasets, dataset, campaigns, campaign }: { datasets: { key: string; name: string }[]; dataset: string | null; campaigns: { key: string; name: string }[]; campaign: string }) {
  const { pending, update } = useReportNavigation();
  return <div className="ad-filters"><label className="report-field">Source report <NativeSelect aria-label="Source report" disabled={!datasets.length || pending} value={dataset ?? ""} onChange={event => update({ dataset: event.target.value, campaign: "" })}>{!datasets.length && <NativeSelectOption value="">No reports imported</NativeSelectOption>}{datasets.map(row => <NativeSelectOption key={row.key} value={row.key}>{row.name}</NativeSelectOption>)}</NativeSelect></label><label className="report-field">Campaign <NativeSelect aria-label="Ad campaign" disabled={!campaigns.length || pending} value={campaign} onChange={event => update({ campaign: event.target.value })}>{campaigns.map(row => <NativeSelectOption key={row.key} value={row.key}>{row.name}</NativeSelectOption>)}</NativeSelect></label></div>;
}
