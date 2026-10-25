"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";

export function OrderDetailsSyncButton({ shopId, disabled, label = "Refresh order details" }: { shopId: string; disabled: boolean; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  async function refresh() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/shops/${encodeURIComponent(shopId)}/order-details`, { method: "POST" });
      const result = await response.json();
      setMessage(response.ok ? (label === "Refresh returns" ? `${result.returns.processed} return cases refreshed.` : `${result.processed} order details refreshed.`) : result.error === "SHOP_JOB_BUSY" ? "Order details are already refreshing." : "Could not refresh order details. Try again shortly.");
      router.refresh();
    } catch { setMessage("Could not reach the server. Try again."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-1"><Button variant="outline" disabled={disabled || busy} onClick={refresh}>{busy ? "Refreshing details…" : label}</Button>{message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}</div>;
}
