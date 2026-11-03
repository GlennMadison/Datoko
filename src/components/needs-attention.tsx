import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { getAttentionSummary } from "@/server/attention";

export async function NeedsAttention() {
  const summary = await getAttentionSummary();
  const rows = [
    ...(summary.status === "ready" && summary.orders > 0
      ? [{ label: "Orders awaiting processing", href: "/overview/attention?kind=orders", count: summary.orders }]
      : []),
    ...("issue" in summary && summary.issue
      ? [{ label: summary.issue, href: "/settings/sync", count: null }]
      : []),
    ...(summary.status === "ready" && summary.costs > 0
      ? [{ label: "Variants missing COGS", href: "/overview/attention?kind=costs", count: summary.costs }]
      : []),
  ];
  return <Card role="region" aria-label="Needs attention">
    <div className="card-heading"><h2>Needs attention</h2></div>
    <div className="px-5 pb-5">
      {rows.length > 0 && <ul className="divide-y divide-border">
        {rows.map(row => <li key={row.href}>
          <Link href={row.href} prefetch={false} className="text-link flex min-h-10 w-full items-center justify-between gap-3 py-2">
            <span>{row.label}</span>{row.count !== null && <Badge tone="orange">{row.count}</Badge>}
          </Link>
        </li>)}
      </ul>}
      {summary.status === "unavailable" && <p className="muted">Unable to check orders and costs. Refresh to try again.</p>}
      {summary.status === "ready" && rows.length === 0 && <p className="muted">All caught up.</p>}
      {summary.status === "no-shop" && <p className="muted">Connect a shop to see current issues.</p>}
      {summary.status === "disconnected" && <Link href="/settings/integrations" className="text-link">Reconnect Shopee to check your shop.</Link>}
    </div>
  </Card>;
}
