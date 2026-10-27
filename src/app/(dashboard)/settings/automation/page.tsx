import Link from "next/link";
import { headers } from "next/headers";
import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { getConfig, isDemo } from "@/server/env";
import { Card, Badge, EmptyState, PageHeading } from "@/components/ui";
import { AutoProcessControls } from "@/components/auto-process-controls";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { timeLabel } from "@/lib/format";
import { processingMessage } from "@/core/auto-process";
import type { CourierChannel, PickupAddress } from "@/core/courier-shipping";

const labels: Record<string, string> = {
  CHECKING: "Checking", WAITING: "Waiting", READ_FAILED: "Will retry",
  REQUESTED: "Confirming", UNCERTAIN: "Needs review", REVIEW: "Needs review",
  ARRANGED: "Shipment arranged", SKIPPED: "Skipped",
};
export default async function AutomationPage() {
  const demo = isDemo();
  const actor = demo ? null : await requireUser(await headers());
  const shop = actor ? await getDb().shop.findFirst({
    where: { ownerId: actor.ownerId, environment: getConfig().SHOPEE_ENV },
    include: { connection: true, automation: true, courierRules: true },
  }) : null;
  const attempts = shop ? await getDb().orderProcessing.findMany({
    where: { shopId: shop.id }, include: { order: { select: { orderSn: true } } },
    orderBy: { updatedAt: "desc" }, take: 50,
  }) : [];
  const enabled = shop?.automation?.enabled ?? false;
  const connected = shop?.connection?.status === "CONNECTED";
  const channels = demo ? [
    { id: "1001", name: "Anteraja Reguler", enabled: true }, { id: "1002", name: "Anteraja Same Day", enabled: true },
    { id: "1003", name: "SPX Standard", enabled: true },
  ] : (shop?.automation?.channels ?? []) as CourierChannel[];
  const addresses = (shop?.automation?.addresses ?? []) as PickupAddress[];
  const rules = (shop?.courierRules ?? []).map(r => ({
    channelId: r.channelId, enabled: r.enabled, method: r.method, pickupAddressId: r.pickupAddressId,
    fallbackDropoff: r.fallbackDropoff, branchId: r.branchId, senderRealName: r.senderRealName,
  }));
  return <>
    <PageHeading title="Order automation" actions={<Badge tone={enabled ? "green" : "neutral"}>{enabled ? "On" : "Off"}</Badge>}/>
    <div className="mb-6">
      <AutoProcessControls shopId={shop?.id} enabled={enabled} connected={connected} disabled={demo || !shop}
        channels={channels} addresses={addresses} rules={rules}/>
      <div className="mt-4 space-y-1 text-xs leading-relaxed text-muted-foreground">
        <p>Applies to new paid orders placed after both automation and their courier service are enabled. Runs during background sync, at least one hour after payment.</p>
        <p>You still pack the items, print shipping labels, and hand parcels to the courier. Unpaid, COD, cancelled, already arranged, and split-package orders require no automatic shipment request.</p>
        {demo ? <p>Demo mode is read-only. Courier names shown are examples.</p> : !connected ? <p>Connect your Shopee shop to load couriers and enable automation.</p> : null}
        {shop?.automation?.lastErrorCode && !["PAYMENT_OR_WAITING_PERIOD", "PICKUP_UNAVAILABLE"].includes(shop.automation.lastErrorCode) && <p role="status">{processingMessage(shop.automation.lastErrorCode)}</p>}
        {shop?.automation?.lastRunAt && <p>Last checked: {timeLabel(shop.automation.lastRunAt)}</p>}
        {shop?.automation?.catalogUpdatedAt && <p>Courier list updated: {timeLabel(shop.automation.catalogUpdatedAt)}</p>}
        {enabled && shop?.automation && <p>Active for orders placed since {timeLabel(shop.automation.enabledFrom)}.</p>}
      </div>
    </div>
    <Card>
      <div className="card-heading"><h2>Processing history</h2><Link href="/settings/automation" className="text-link">Refresh</Link></div>
      {attempts.length ? <div className="table-scroll" tabIndex={0}><Table>
        <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Courier</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead><TableHead>Updated</TableHead><TableHead>Details</TableHead></TableRow></TableHeader>
        <TableBody>{attempts.map(attempt => <TableRow key={attempt.id}>
          <TableCell><Link href={"/orders/" + encodeURIComponent(attempt.order.orderSn)} className="text-link">{attempt.order.orderSn}</Link></TableCell>
          <TableCell>{channels.find(c => c.id === attempt.channelId)?.name ?? "—"}</TableCell>
          <TableCell>{attempt.method === "pickup" ? "Pickup" : attempt.method === "dropoff" ? "Drop off" : "—"}</TableCell>
          <TableCell><Badge tone={attempt.status === "ARRANGED" ? "green" : ["REVIEW", "UNCERTAIN", "READ_FAILED"].includes(attempt.status) ? "orange" : "neutral"}>{labels[attempt.status] ?? attempt.status}</Badge></TableCell>
          <TableCell className="whitespace-nowrap">{timeLabel(attempt.updatedAt)}</TableCell>
          <TableCell className="min-w-56 max-w-lg whitespace-normal text-muted-foreground">{attempt.status === "CHECKING" ? "Checking order and courier availability." : attempt.status === "REQUESTED" ? "Checking whether Shopee accepted the shipment request." : processingMessage(attempt.errorCode)}</TableCell>
        </TableRow>)}</TableBody>
      </Table></div> : <EmptyState title="No orders processed yet">{enabled ? "New eligible orders will appear after the next background sync." : "Configure your couriers and turn on auto processing to get started."}</EmptyState>}
    </Card>
  </>;
}
