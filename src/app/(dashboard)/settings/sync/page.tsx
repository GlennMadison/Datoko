import { getDashboardData } from "@/server/dashboard";
import { Card, Badge, Status, EmptyState, PageHeading } from "@/components/ui";
import { SyncButton } from "@/components/sync-button";
import { timeLabel } from "@/lib/format";

export default async function SyncHistory() {
  const data = await getDashboardData();
  return <><PageHeading title="Sync history" actions={<SyncButton shopId={data.shop?.id} disabled={data.mode === "demo" || data.shop?.status !== "CONNECTED"}/>}/><div className="sync-resources"><Card><div className="card-heading"><h2>Orders</h2><Badge tone={data.lastSyncedAt ? "green" : "neutral"}>{data.lastSyncedAt ? "Imported" : "Awaiting import"}</Badge></div><p>Last successful window: {timeLabel(data.lastSyncedAt)}</p><p>Observed update coverage from: {timeLabel(data.coverageFrom)}</p><p>Changes processed through: {timeLabel(data.ordersCheckpoint)}</p></Card><Card><div className="card-heading"><h2>Returns & settlements</h2><Badge tone="orange">Pending validation</Badge></div><p>Sync is not yet enabled for these sources. Live profit totals remain incomplete.</p></Card></div><Card><div className="card-heading"><div><h2>Recent sync runs</h2><p>Background jobs continue when the dashboard is closed.</p></div></div>{data.runs.length ? <div className="table-scroll" tabIndex={0}><table><thead><tr><th>Started</th><th>Trigger</th><th>Status</th><th>Orders processed</th><th>Issue</th></tr></thead><tbody>{data.runs.map(run => <tr key={run.id}><td>{timeLabel(run.createdAt)}</td><td>{run.reason.toLowerCase()}</td><td><Status value={run.status}/></td><td>{run.processed}</td><td className="muted">{run.errorCode ?? "—"}</td></tr>)}</tbody></table></div> : <EmptyState title="No sync runs">Connect a shop to start its first import.</EmptyState>}</Card></>;
}
