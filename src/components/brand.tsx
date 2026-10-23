import Link from "next/link";
import { ChartNoAxesCombined } from "lucide-react";
import { cn } from "@/lib/utils";

export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return <Link href="/overview" aria-label="Datoko home" className={cn("flex items-center gap-2.5 font-semibold tracking-tight", className)}>
    <span className={cn("flex shrink-0 items-center justify-center bg-primary text-primary-foreground", compact ? "size-8 rounded-lg" : "size-9 rounded-xl")}><ChartNoAxesCombined className="size-5" aria-hidden="true"/></span>
    {!compact && <span className="brand-wordmark text-xl">datoko<span className="text-primary">.</span></span>}
  </Link>;
}
