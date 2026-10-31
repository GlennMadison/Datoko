"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { REPORT_KEYS } from "@/core/reporting-period";

type ReportNavigation = { pending: boolean; update: (patch: Record<string, string>, resetRange?: boolean) => void; getQuery: () => string; refresh: () => Promise<void> };
const Context = createContext<ReportNavigation | null>(null);
export function ReportNavigationProvider({ children, demo = false }: { children: ReactNode; demo?: boolean }) {
  const router = useRouter(), pathname = usePathname(), search = useSearchParams();
  const latest = useRef(search.toString());
  const [navigating, startTransition] = useTransition();
  const [refreshing, setRefreshing] = useState(false);
  const pending = navigating || refreshing;
  useEffect(() => { if (!pending) latest.current = search.toString(); }, [search, pathname, pending]);
  const getQuery = useCallback(() => latest.current, []);
  const update = useCallback((patch: Record<string, string>, resetRange = false) => {
    const params = new URLSearchParams(latest.current);
    if (resetRange) params.delete("page");
    if (resetRange) for (const key of REPORT_KEYS) if (key !== "interval" && key !== "tz") params.delete(key);
    for (const [key, value] of Object.entries(patch)) if (value) params.set(key, value); else params.delete(key);
    const next = params.toString();
    if (next === latest.current) return;
    latest.current = next;
    startTransition(() => router.push(`${pathname}?${next}`, { scroll: false }));
  }, [pathname, router]);
  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      if (!demo) {
        const response = await fetch("/api/workspace/refresh", { method: "POST" });
        if (!response.ok) throw new Error("Could not refresh report");
      }
      startTransition(() => router.refresh());
    } finally { setRefreshing(false); }
  }, [demo, refreshing, router]);
  return <Context.Provider value={{ pending, update, getQuery, refresh }}>{children}</Context.Provider>;
}
export function useReportNavigation(): ReportNavigation {
  const context = useContext(Context);
  if (!context) throw new Error("Reporting controls require their navigation provider.");
  return context;
}
