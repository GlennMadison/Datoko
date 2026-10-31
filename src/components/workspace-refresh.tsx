"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { refreshDelay, SYNC_REQUESTED_EVENT, type WorkspaceStatus } from "@/core/workspace-refresh";

export function WorkspaceRefresh({ initial }: { initial: WorkspaceStatus }) {
  const router = useRouter(), pathname = usePathname();
  const latest = useRef(initial);
  useEffect(() => { latest.current = initial; }, [initial]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined, stopped = false, failures = 0;
    let request: AbortController | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (!stopped && document.visibilityState === "visible") timer = setTimeout(check, refreshDelay(latest.current.active, failures));
    };
    async function check() {
      if (stopped || document.visibilityState !== "visible" || request) return;
      request = new AbortController();
      try {
        const response = await fetch("/api/workspace/status", { cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]) });
        if (response.status === 401 || response.status === 403) { stopped = true; router.refresh(); return; }
        if (!response.ok) throw new Error("Status unavailable");
        const status: WorkspaceStatus = await response.json();
        if (stopped) return;
        if (typeof status.version !== "string" || typeof status.active !== "boolean" || typeof status.connected !== "boolean") throw new Error("Invalid status");
        const changed = status.version !== latest.current.version;
        latest.current = status; failures = 0;
        if (changed && !stopped) router.refresh();
      } catch { if (!stopped) failures++; }
      finally { request = undefined; schedule(); }
    }
    const visibility = () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") void check();
      else request?.abort();
    };
    const requested = () => { latest.current = { ...latest.current, active: true }; clearTimeout(timer); void check(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener(SYNC_REQUESTED_EVENT, requested);
    schedule();
    return () => { stopped = true; clearTimeout(timer); request?.abort(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener(SYNC_REQUESTED_EVENT, requested); };
  }, [router, pathname]);
  return null;
}
