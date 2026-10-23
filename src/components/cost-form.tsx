"use client";
import { Input } from "@/components/ui/input";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui";

export function CostForm({ variantId, name, disabled }: { variantId: string; name: string; disabled: boolean }) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const action = `/api/variants/${encodeURIComponent(variantId)}/costs`;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || busy) return;
    const form = event.currentTarget;
    setBusy(true); setMessage(""); setFailed(false);
    try {
      const response = await fetch(action, { method: "POST", body: new FormData(form) });
      if (!response.ok || !response.redirected || new URL(response.url).pathname !== "/products") {
        setFailed(true);
        setMessage(response.status === 401 || new URL(response.url).pathname === "/login" ? "Sign in again to save this cost." : "Cost was not saved. Check the amount and try again.");
        return;
      }
      setMessage("Cost saved. Past orders are unchanged.");
      form.reset();
      router.refresh();
    } catch { setFailed(true); setMessage("Could not reach the server. Try again."); }
    finally { setBusy(false); }
  }
  return <div><form className="cost-form" action={action} method="post" onSubmit={save} aria-label={`Update cost for ${name}`} aria-busy={busy}>
    <label className="sr-only" htmlFor={id}>New cost for {name}</label><Input id={id} name="amount" type="number" min="0" step="0.0001" required placeholder="e.g. 46000" aria-describedby={message ? `${id}-feedback` : undefined} disabled={disabled || busy}/>
    <input type="hidden" name="note" value="Updated from product costs"/><Button disabled={disabled || busy}>{busy ? "Saving…" : "Save cost"}</Button>
  </form>{message && <p id={`${id}-feedback`} className="cost-feedback" role={failed ? "alert" : "status"}>{message}</p>}</div>;
}
