"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Package } from "lucide-react";
import { ReportLink as Link } from "./report-link";
import type { OrderRow } from "@/server/dashboard";
import { rupiah, dateLabel } from "@/lib/format";
import { Status, Badge, EmptyState } from "./ui";
import { Button } from "./ui/button";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

type SortKey = "name" | "createdAt" | "total" | "profit";
export function OrderTable({ orders, filtered = false, paginated = false }: { orders: OrderRow[]; filtered?: boolean; paginated?: boolean }) {
  const [sort, setSort] = useState<{ key: SortKey; direction: number } | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const sorted = sort ? [...orders].sort((a, b) => (sort.key === "profit" ? (a.profit ?? -Infinity) - (b.profit ?? -Infinity) : sort.key === "total" ? Number(a.total) - Number(b.total) : sort.key === "createdAt" ? Date.parse(a.createdAt) - Date.parse(b.createdAt) : a.name.localeCompare(b.name)) * sort.direction) : orders;
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const rows = paginated ? sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize) : sorted;
  function changeSort(key: SortKey) { setSort(value => ({ key, direction: value?.key === key ? -value.direction : key === "name" ? 1 : -1 })); setPage(0); }
  function sortLabel(key: SortKey, label: string) {
    const Direction = sort?.key === key ? sort.direction === 1 ? ArrowUp : ArrowDown : ArrowUpDown;
    return <button type="button" className="inline-flex min-h-8 items-center gap-2 text-xs hover:text-foreground" onClick={() => changeSort(key)} aria-label={"Sort by " + label.toLowerCase()}>{label}<Direction className="size-3 text-muted-foreground" aria-hidden="true"/></button>;
  }
  if (!orders.length) return <EmptyState title={filtered ? "No matching orders" : "No orders in this period"}>{filtered ? "Try another search or clear the filters." : "Choose a different date range, or connect a shop and sync its orders."}</EmptyState>;
  return <>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Orders"><Table>
      <TableHeader><TableRow><TableHead aria-sort={sort?.key === "name" ? sort.direction === 1 ? "ascending" : "descending" : undefined}>{sortLabel("name", "Order / product")}</TableHead><TableHead aria-sort={sort?.key === "createdAt" ? sort.direction === 1 ? "ascending" : "descending" : undefined}>{sortLabel("createdAt", "Date")}</TableHead><TableHead>Status</TableHead><TableHead className="text-right" aria-sort={sort?.key === "total" ? sort.direction === 1 ? "ascending" : "descending" : undefined}>{sortLabel("total", "Order value")}</TableHead><TableHead className="text-right">{sortLabel("profit", "Net profit")}</TableHead></TableRow></TableHeader>
      <TableBody>{rows.map(order => <TableRow key={order.id}>
        <TableCell><div className="flex items-center gap-3"><span className="hidden size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground sm:flex"><Package className="size-4" aria-hidden="true"/></span><div><Link href={"/orders/" + encodeURIComponent(order.orderSn)} className="order-name">{order.name}</Link>{order.variationName && <div className="subtext">{order.variationName}</div>}<div className="subtext font-mono">{order.orderSn}<span className="muted-dot">·</span>{order.quantity} item{order.quantity === 1 ? "" : "s"}</div><div className="mt-1 flex items-center gap-2">{order.costMissing && <span className="cost-flag">Cost missing</span>}{order.hasReturn && <Badge tone="orange">Return</Badge>}</div></div></div></TableCell>
        <TableCell className="text-muted-foreground">{dateLabel(order.createdAt)}</TableCell><TableCell><Status value={order.status}/></TableCell><TableCell className="text-right font-medium tabular-nums">{rupiah(order.total)}</TableCell><TableCell className="text-right tabular-nums"><div className={order.profit != null && order.profit < 0 ? "text-destructive" : "font-medium"}>{rupiah(order.profit ?? null)}</div><div className="subtext">{order.profitQuality === "ESTIMATED" ? "Estimated" : order.profitQuality === "SETTLED" ? "After fees & COGS" : order.profitQuality === "EXCLUDED" ? "Excluded" : order.costMissing ? "Cost missing" : "Payout pending"}</div></TableCell>
      </TableRow>)}</TableBody>
    </Table></div>
    {paginated && <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-[11px] text-muted-foreground">
      <span role="status">Showing {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, orders.length)} of {orders.length} orders</span>
      <div className="flex items-center gap-3"><label className="flex items-center gap-2"><span className="hidden sm:inline">Rows per page</span><NativeSelect className="h-8 w-16 text-xs" aria-label="Orders per page" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(0); }}>{[10, 25, 50].map(size => <NativeSelectOption key={size} value={size}>{size}</NativeSelectOption>)}</NativeSelect></label><span>{currentPage + 1} / {pages}</span><div className="flex gap-1"><Button variant="outline" size="icon-sm" aria-label="Previous orders page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft className="size-4"/></Button><Button variant="outline" size="icon-sm" aria-label="Next orders page" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight className="size-4"/></Button></div></div>
    </div>}
  </>;
}
