"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";
import { REPORT_KEYS } from "@/core/reporting-period";

export function ReportLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const search = useSearchParams();
  const target = new URL(href, "http://datoko.invalid");
  if (!href.startsWith("/") || target.origin !== "http://datoko.invalid") throw new Error("Report links must use local paths.");
  for (const key of REPORT_KEYS) if (!target.searchParams.has(key) && search.getAll(key).length === 1) target.searchParams.set(key, search.get(key)!);
  return <Link {...props} href={`${target.pathname}${target.search}${target.hash}`}/>;
}
