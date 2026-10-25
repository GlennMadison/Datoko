"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";

export function FinanceSyncButton({ shopId, orderSn, disabled = false }: { shopId: string; orderSn?: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  async function sync() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/shops/${encodeURIComponent(shopId)}/finance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderSn }) });
      const result = await response.json();
      if (!response.ok || result.lastError) setMessage(result.lastError === "SHOPEE_PERMISSION_DENIED" ? "Shopee has not granted payment access. Check your app permissions." : "Some payouts could not be refreshed. Try again shortly.");
      else setMessage(`${result.synced} order payouts refreshed.`);
      router.refresh();
    } catch { setMessage("Could not refresh payouts. Try again."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-1"><Button variant="outline" disabled={disabled || busy} onClick={sync}>{busy ? "Refreshing payouts…" : "Refresh payouts"}</Button>{message && <p className="text-xs text-muted-foreground" role="status">{message}</p>}</div>;
}
