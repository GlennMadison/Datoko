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
