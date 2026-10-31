"use client";
import { useState } from "react";
import { Button } from "./ui";
import { Icon } from "./icons";
import { SYNC_REQUESTED_EVENT } from "@/core/workspace-refresh";

export function SyncButton({ shopId, disabled = false }: { shopId?: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function sync() {
    if (!shopId) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/shops/${encodeURIComponent(shopId)}/sync`, { method: "POST" });
      if (!response.ok) throw new Error();
      setMessage("Sync queued. See sync history for progress.");
      window.dispatchEvent(new Event(SYNC_REQUESTED_EVENT));
    } catch { setMessage("Could not start sync. Check your connection settings."); }
    finally { setBusy(false); }
  }
  return <div className="sync-action"><Button className="button-outline" disabled={disabled || busy || !shopId} title={disabled || !shopId ? "Connect a shop in a live workspace to sync orders" : undefined} aria-busy={busy} onClick={sync}><Icon name="sync" size={15}/>{busy ? "Queuing…" : "Sync now"}</Button>{message && <span className="action-message" role="status">{message}</span>}</div>;
}

export function HistorySyncButton({ shopId, disabled, active, complete, runId }: { shopId?: string; disabled: boolean; active: boolean; complete: boolean; runId?: string }) {
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState<string | null>(null);
  const waiting = !!queued && runId !== queued;
  const [message, setMessage] = useState("");
  async function syncHistory() {
    if (!shopId || busy || active || waiting) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/shops/${encodeURIComponent(shopId)}/sync?scope=history`, { method: "POST" });
      if (!response.ok) throw new Error();
      setQueued((await response.json()).runId);
      setMessage("History sync queued. Progress updates here automatically.");
      window.dispatchEvent(new Event(SYNC_REQUESTED_EVENT));
    } catch { setMessage("Could not start history sync. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return <div className="sync-action">
    <Button variant="outline" disabled={disabled || !shopId || busy || waiting || active || complete} aria-busy={busy || waiting || active} onClick={syncHistory}>
      <Icon name="sync" size={15}/>{busy ? "Queuing…" : active || waiting ? "History sync in progress" : complete ? "History checked" : "Sync all history"}
    </Button>
    {message && <span className="action-message" role="status">{message}</span>}
  </div>;
}
