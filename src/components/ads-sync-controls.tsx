"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui";
import { Icon } from "./icons";
import { SYNC_REQUESTED_EVENT } from "@/core/workspace-refresh";

export function AdsSyncControls({ connected, pending, intervalMinutes, lastSyncLabel }: { connected: boolean; pending: boolean; intervalMinutes: number; lastSyncLabel: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { if (!pending) setMessage(""); }, [pending]);
  async function sync() {
    if (busy || !connected || pending) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/advertisement/sync", { method: "POST" });
      if (!response.ok) throw new Error();
      setMessage("Ads sync queued. The worker usually starts within a minute.");
      window.dispatchEvent(new Event(SYNC_REQUESTED_EVENT));
    } catch { setMessage("Could not queue ads sync. Check your shop connection and try again."); }
    finally { setBusy(false); }
  }
  return <div className="sync-action report-sync">
    <p className="page-note" title={`Automatic sync every ${intervalMinutes} minutes`}>{connected ? `Synced: ${lastSyncLabel}` : "Connect your shop to sync ads."}</p>
    <Button className="button-outline" onClick={sync} disabled={!connected || busy || pending} aria-busy={busy}>
      <Icon name="sync" size={15}/>{busy ? "Queuing..." : pending ? "Ads sync queued" : "Sync ads"}
    </Button>
    {message && <span role="status" className="action-message">{message}</span>}
  </div>;
}
