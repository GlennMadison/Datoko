import Link from "next/link";
import { CostForm } from "@/components/cost-form";
import { Card, PageHeading } from "@/components/ui";
import { timeLabel } from "@/lib/format";
import { getAttentionPage } from "@/server/attention";

export default async function AttentionPage({ searchParams }: {
  searchParams: Promise<{ kind?: string | string[]; page?: string | string[] }>;
}) {
  const query = await searchParams;
  const kind = query.kind === "costs" ? "costs" : "orders";
  const page = typeof query.page === "string" && /^[1-9]\d{0,3}$/.test(query.page) ? Number(query.page) : 1;
  const data = await getAttentionPage(kind, page);
  const pageHref = (target: number) => `/overview/attention?kind=${kind}&page=${target}`;
  return <>
    <Link href="/overview" className="back-link">Back to Overview</Link>
    <PageHeading title={kind === "costs" ? "Variants missing COGS" : "Orders awaiting processing"}
      description={kind === "costs"
        ? "Variants sold in the last 90 days without a current unit cost."
        : "Paid orders still awaiting processing after the usual wait."}/>
    <Card>
      {!data ? <p className="muted">Connect a shop to see current issues.</p> : data.rows.length === 0
        ? <p className="muted">{page === 1 ? "All caught up." : "No remaining items on this page."}</p>
        : <ul className="divide-y divide-border">
          {data.kind === "orders" ? data.rows.map(order => <li key={order.orderSn} className="flex flex-wrap justify-between gap-2 py-3">
            <Link className="text-link" href={`/orders/${encodeURIComponent(order.orderSn)}`} prefetch={false}>{order.orderSn}</Link>
            <span className="muted">Paid {timeLabel(order.paidAt?.toISOString() ?? null)}</span>
          </li>) : data.rows.map(variant => {
            const detail = [variant.variationName, variant.sku].filter(Boolean).join(" / ");
            const label = detail ? `${variant.name} (${detail})` : variant.name;
            return <li key={variant.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <strong>{label}</strong><CostForm variantId={variant.id} name={label} disabled={false}/>
            </li>;
          })}
        </ul>}
      {data && (page > 1 || data.hasNext) && <nav aria-label="Attention pages" className="mt-4 flex gap-4">
        {page > 1 && <Link className="text-link" href={pageHref(page - 1)}>Previous</Link>}
        <span className="muted">Page {page}</span>
        {data.hasNext && page < 9999 && <Link className="text-link" href={pageHref(page + 1)}>Next</Link>}
      </nav>}
    </Card>
  </>;
}
