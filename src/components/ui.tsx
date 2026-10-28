import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { Inbox } from "lucide-react";
import { Button as ShadcnButton } from "./ui/button";
import { Card as ShadcnCard } from "./ui/card";
import { Badge as ShadcnBadge } from "./ui/badge";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";

export function Card({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <ShadcnCard className={cn("card gap-0 overflow-hidden py-0 shadow-xs", className)} {...props}>{children}</ShadcnCard>;
}
export function Button({ className, variant, ...props }: ComponentProps<typeof ShadcnButton>) {
  return <ShadcnButton variant={variant ?? (className?.includes("button-outline") ? "outline" : "default")} className={cn("text-xs", className)} {...props}/>;
}
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "orange" | "red" }) {
  return <ShadcnBadge variant="secondary" className={cn("badge gap-1.5 rounded-md border-transparent px-2 py-0.5 text-[10px] font-medium", {
    "bg-primary/10 text-primary": tone === "green",
    "bg-warning/10 text-warning": tone === "orange",
    "bg-destructive/10 text-destructive": tone === "red",
  })}>{children}</ShadcnBadge>;
}
export function Status({ value }: { value: string }) {
  const labels: Record<string, string> = { COMPLETED: "Completed", READY_TO_SHIP: "Ready to ship", SHIPPED: "Shipped", CANCELLED: "Cancelled", CONNECTED: "Connected", NOT_CONNECTED: "Not connected", RECONNECT_REQUIRED: "Reconnect required", DISCONNECTED: "Disconnected", SUCCEEDED: "Succeeded", RUNNING: "Running", QUEUED: "Queued", RETRYING: "Retrying", FAILED: "Failed", RESOLVED: "Resolved" };
  const tone = ["COMPLETED", "CONNECTED", "SUCCEEDED", "RESOLVED"].includes(value) ? "green" : ["CANCELLED", "FAILED", "RECONNECT_REQUIRED"].includes(value) ? "red" : ["READY_TO_SHIP", "RUNNING", "RETRYING"].includes(value) ? "orange" : "neutral";
  return <Badge tone={tone}><span className="size-1 rounded-full bg-current" aria-hidden="true"/>{labels[value] ?? value.replaceAll("_", " ").toLowerCase()}</Badge>;
}
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state"><span className="mb-2 flex size-11 items-center justify-center rounded-xl border bg-muted/50"><Inbox className="size-5 text-muted-foreground" aria-hidden="true"/></span><h3>{title}</h3><p>{children}</p></div>;
}
export function PageHeading({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</div>;
}
export function Metric({ label, value, note, featured = false, testId, icon, comparison }: { label: string; value: ReactNode; note?: string; featured?: boolean; testId?: string; icon?: string; comparison?: ReactNode }) {
  return <div className={cn("metric rounded-xl border bg-card p-5 shadow-xs", featured && "border-primary/30")}>
    <dt className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground"><span>{label}</span>{icon && <Icon name={icon} size={16}/>}</dt>
    <dd className={cn("metric-value numeric mt-3 text-[26px] font-semibold leading-tight tracking-tight", featured && "text-primary")} data-testid={testId}>{value}</dd>
    {note && <dd className="metric-note mt-2 text-[11px] leading-relaxed text-muted-foreground">{note}</dd>}
    {comparison && <dd className="mt-3 border-t border-border/60 pt-3">{comparison}</dd>}
  </div>;
}
