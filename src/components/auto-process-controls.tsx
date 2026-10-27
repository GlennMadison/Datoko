"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Input } from "./ui/input";
import type { CourierChannel, PickupAddress } from "@/core/courier-shipping";

export type SavedCourierRule = {
  channelId: string; enabled: boolean; method: string; pickupAddressId: string | null;
  fallbackDropoff: boolean; branchId: string | null; senderRealName: string | null;
};
const errors: Record<string, string> = {
  SHOPEE_RECONNECT_REQUIRED: "Reconnect your Shopee shop first.",
  NO_COURIERS_ENABLED: "Enable at least one courier below first.",
  PICKUP_ADDRESS_REQUIRED: "Choose a pickup address first.",
  COURIER_NOT_AVAILABLE: "This service is unavailable. Refresh couriers from Shopee.",
  SHOPEE_PERMISSION_DENIED: "Shopee logistics permission is missing. Check the app permissions.",
  SHOP_JOB_BUSY: "Automation is running. Try saving again shortly.",
};
async function save(shopId: string, data: unknown) {
  const response = await fetch("/api/shops/" + encodeURIComponent(shopId) + "/auto-process", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(errors[result.error] ?? "Could not save. Please try again.");
  return result;
}
function Toggle({ checked, disabled, label, onClick }: { checked: boolean; disabled: boolean; label: string; onClick(): void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onClick}
    className={"relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 " + (checked ? "border-primary bg-primary" : "border-input bg-muted")}>
    <span aria-hidden="true" className={"block size-4 rounded-full bg-white shadow-sm transition-transform " + (checked ? "translate-x-6" : "translate-x-1")}/>
  </button>;
}
function CourierRow({ channel, initial, addresses, shopId, disabled }: {
  channel: CourierChannel; initial?: SavedCourierRule; addresses: PickupAddress[]; shopId?: string; disabled: boolean;
}) {
  const router = useRouter();
  const [rule, setRule] = useState<SavedCourierRule>(initial ?? { channelId: channel.id, enabled: false, method: "dropoff", pickupAddressId: null, fallbackDropoff: false, branchId: null, senderRealName: null });
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  function change(patch: Partial<SavedCourierRule>) { setRule(previous => ({ ...previous, ...patch })); setDirty(true); setMessage(""); }
  function persist(next: SavedCourierRule) {
    if (!shopId || disabled) return;
    setMessage(""); setFailed(false);
    startTransition(async () => {
      try { await save(shopId, { rule: next }); setRule(next); setDirty(false); setMessage("Saved"); router.refresh(); }
      catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Could not save."); }
    });
  }
  const locked = disabled || pending;
  return <div className="border-t px-5 py-5 first:border-t-0 sm:px-6">
    <div className="flex items-center justify-between gap-4">
      <div><h3 className="text-sm font-medium">{channel.name.replace(/^Anteraja\s*/i, "")}</h3>{!channel.enabled && <p className="mt-0.5 text-xs text-muted-foreground">Disabled in Shopee</p>}</div>
      <Toggle checked={rule.enabled} disabled={locked || !channel.enabled && !rule.enabled} label={"Auto process " + channel.name} onClick={() => persist({ ...rule, enabled: !rule.enabled })}/>
    </div>
    <div className="mt-4 grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div className="space-y-1.5"><label htmlFor={"method-" + channel.id} className="text-xs font-medium">Shipment method</label>
        <NativeSelect id={"method-" + channel.id} value={rule.method} disabled={locked || !channel.enabled} onChange={event => change({ method: event.target.value })}>
          <NativeSelectOption value="dropoff">Drop off</NativeSelectOption><NativeSelectOption value="pickup">Request pickup</NativeSelectOption>
        </NativeSelect>
      </div>
      {rule.method === "pickup" && <>
        <div className="space-y-1.5 sm:col-span-1 lg:col-span-2"><label htmlFor={"address-" + channel.id} className="text-xs font-medium">Pickup address</label>
          <NativeSelect id={"address-" + channel.id} value={rule.pickupAddressId ?? ""} disabled={locked} onChange={event => change({ pickupAddressId: event.target.value || null })}>
            <NativeSelectOption value="">{addresses.length ? "Select address" : "No pickup addresses found"}</NativeSelectOption>
            {addresses.map(a => <NativeSelectOption key={a.id} value={a.id}>{a.label}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-3">
          <input type="checkbox" checked={rule.fallbackDropoff} disabled={locked} onChange={event => change({ fallbackDropoff: event.target.checked })} className="size-4 accent-primary"/>
          Use drop-off if pickup is unavailable
        </label>
        <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">Availability is checked for each order. Shopee's recommended pickup slot is selected when available. {rule.fallbackDropoff ? "Drop-off is used only when Shopee supports it." : "If pickup is unavailable, the order waits for the next background check."}</p>
      </>}
    </div>
    <details className="mt-3 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer">Extra drop-off details</summary>
      <div className="mt-3 grid max-w-xl gap-3 sm:grid-cols-2">
        <label className="space-y-1.5"><span>Branch ID, if required</span><Input value={rule.branchId ?? ""} inputMode="numeric" maxLength={16} disabled={locked} onChange={e => change({ branchId: e.target.value || null })}/></label>
        <label className="space-y-1.5"><span>Sender name, if required</span><Input value={rule.senderRealName ?? ""} maxLength={100} disabled={locked} onChange={e => change({ senderRealName: e.target.value || null })}/></label>
      </div><p className="mt-2">Leave blank unless your courier requires them. The branch is validated against the order's available branches.</p>
    </details>
    {(dirty || pending || message) && <div className="mt-4 flex items-center gap-3">
      {dirty && <Button size="sm" variant="outline" disabled={locked} onClick={() => persist(rule)}>{pending ? "Saving…" : "Save changes"}</Button>}
      {message && <p role={failed ? "alert" : "status"} className={"text-xs " + (failed ? "text-destructive" : "text-muted-foreground")}>{message}</p>}
    </div>}
  </div>;
}
export function AutoProcessControls({ shopId, enabled, disabled, connected, channels, addresses, rules }: {
  shopId?: string; enabled: boolean; disabled: boolean; connected: boolean;
  channels: CourierChannel[]; addresses: PickupAddress[]; rules: SavedCourierRule[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  function action(data: unknown) {
    if (!shopId || disabled) return;
    setMessage("");
    startTransition(async () => {
      try { const result = await save(shopId, data); setMessage(result.addressError ?? ""); router.refresh(); }
      catch (error) { setMessage(error instanceof Error ? error.message : "Could not save."); }
    });
  }
  return <>
    <div className="flex items-center justify-between gap-6 rounded-xl border bg-card px-5 py-5 sm:px-6">
      <div><h2 className="text-sm font-semibold">Auto process orders</h2><p className="mt-1 text-sm text-muted-foreground">Arrange shipments for the courier services enabled below.</p></div>
      <Toggle checked={enabled} disabled={disabled || pending || !connected && !enabled} label="Auto process orders" onClick={() => action({ enabled: !enabled })}/>
    </div>
    {message && <p role="alert" className="mt-3 text-sm text-destructive">{message}</p>}
    <section className="mt-5 overflow-hidden rounded-xl border bg-card" aria-labelledby="courier-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6">
        <div><h2 id="courier-heading" className="text-sm font-semibold">Courier services</h2><p className="mt-1 text-xs text-muted-foreground">Regular, same-day, and instant services have separate settings.</p></div>
        <Button variant="outline" size="sm" disabled={disabled || pending || !connected} onClick={() => action({ action: "catalog" })}>{pending ? "Loading…" : channels.length ? "Refresh couriers" : "Load couriers from Shopee"}</Button>
      </div>
      {channels.length ? <div><div className="border-b bg-muted/30 px-5 py-3 sm:px-6"><h3 className="text-sm font-semibold">Anteraja</h3></div>{channels.map(channel => <CourierRow key={channel.id + JSON.stringify(rules.find(r => r.channelId === channel.id))} shopId={shopId} channel={channel} initial={rules.find(r => r.channelId === channel.id)} addresses={addresses} disabled={disabled || pending}/>)}</div> :
        <p className="px-5 py-8 text-sm text-muted-foreground">Load your shop's couriers, choose a shipment method, then enable the services you want to automate.</p>}
    </section>
  </>;
}
