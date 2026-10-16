import Link from "next/link";
import { getDashboardData } from "@/server/dashboard";
import { Card, Badge, Status, EmptyState } from "@/components/ui";
import { rupiah, timeLabel } from "@/lib/format";

export default async function Returns() {
  const data = await getDashboardData();
  return <><div className="page-heading"><div><p className="eyebrow">AFTER THE SALE</p><h1>Returns stay part of the story.</h1><p className="page-description">Track a return separately from its order and financial outcome.</p></div><Badge tone="orange">Live sync awaiting validation</Badge></div><div className="notice"><strong>Reported amounts and confirmed refunds are separate.</strong><span>Live return ingestion is not enabled until your app&apos;s return fields and permissions are verified. A request alone never reduces recorded sales.</span></div><Card><div className="card-heading"><div><h2>Return cases</h2><p>{data.mode === "demo" ? "Illustrative sample case" : "Stored cases; no claim of complete live return coverage"}</p></div></div>{data.returns.length ? <div className="table-scroll"><table><thead><tr><th>Return / order</th><th>Status</th><th>Reported amount</th><th>Confirmed refund</th><th>Updated</th></tr></thead><tbody>{data.returns.map(value => <tr key={value.id}><td><strong>{value.returnSn}</strong><div className="subtext"><Link href={`/orders/${encodeURIComponent(value.orderSn)}`}>{value.orderSn}</Link></div></td><td><Status value={value.status}/></td><td>{rupiah(value.reportedAmount)}</td><td>{rupiah(value.confirmedRefund)}</td><td className="muted">{timeLabel(value.updatedAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="Return data is not connected yet">Once verified, late returns will link to their original orders.</EmptyState>}</Card></>;
}
