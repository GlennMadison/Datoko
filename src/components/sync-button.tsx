"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui";
import { Icon } from "./icons";

export function SyncButton({ shopId, disabled = false }: { shopId?: string; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function sync() {
    if (!shopId) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/shops/${encodeURIComponent(shopId)}/sync`, { method: "POST" });
      if (!response.ok) throw new Error();
      setMessage("Sync queued. See sync history for progress.");
      router.refresh();
    } catch { setMessage("Could not start sync. Check your connection settings."); }
    finally { setBusy(false); }
  }
  return <div className="sync-action"><Button className="button-outline" disabled={disabled || busy || !shopId} title={disabled || !shopId ? "Connect a shop in a live workspace to sync orders" : undefined} aria-busy={busy} onClick={sync}><Icon name="sync" size={15}/>{busy ? "Queuing…" : "Sync now"}</Button>{message && <span className="action-message" role="status">{message}</span>}</div>;
}

export function AutoSync({ shopId, enabled, lastSyncedAt }: { shopId?: string; enabled: boolean; lastSyncedAt: string | null }) {
  const requested = useRef(false);
  const router = useRouter();
  useEffect(() => {
    if (!enabled || !shopId) return;
    if (!requested.current && (!lastSyncedAt || Date.now() - new Date(lastSyncedAt).getTime() > 600_000)) {
      requested.current = true;
      void fetch(`/api/shops/${encodeURIComponent(shopId)}/sync`, { method: "POST" }).catch(() => {});
    }
    const timer = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(timer);
  }, [enabled, shopId, lastSyncedAt, router]);
  return null;
}

export function HistorySyncButton({ shopId, disabled, active, complete, runId }: { shopId?: string; disabled: boolean; active: boolean; complete: boolean; runId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!active && !queued) return;
    const timer = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(timer);
  }, [active, queued, router]);
  useEffect(() => { if (queued && runId === queued) setQueued(null); }, [queued, runId]);
  async function syncHistory() {
    if (!shopId || busy || active || queued) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/shops/${encodeURIComponent(shopId)}/sync?scope=history`, { method: "POST" });
      if (!response.ok) throw new Error();
      setQueued((await response.json()).runId);
      setMessage("History sync queued. Progress updates here automatically.");
      router.refresh();
    } catch { setMessage("Could not start history sync. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return <div className="sync-action">
    <Button variant="outline" disabled={disabled || !shopId || busy || !!queued || active || complete} aria-busy={busy || !!queued || active} onClick={syncHistory}>
      <Icon name="sync" size={15}/>{busy ? "Queuing…" : active || queued ? "History sync in progress" : complete ? "History checked" : "Sync all history"}
    </Button>
    {message && <span className="action-message" role="status">{message}</span>}
  </div>;
}
