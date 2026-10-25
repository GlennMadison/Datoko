import type { OrderProfit, Settlement } from "@/core/profit";
import { amountString, amountUnits } from "@/core/money";
import { Card, Badge } from "./ui";
import { rupiah, timeLabel } from "@/lib/format";
import { FinanceSyncButton } from "./finance-sync-button";

export function OrderProfitCard({ shopId, orderSn, merchandise, result, settlement, observedAt }: { shopId: string; orderSn: string; merchandise: string; result: OrderProfit; settlement: Settlement | null; observedAt: Date | null }) {
  const fees = settlement ? [settlement.commission, settlement.service, settlement.transaction, settlement.affiliate, settlement.other].reduce((sum, value) => sum + amountUnits(value), 0n) : null;
  const adjustment = settlement && fees !== null ? amountString(amountUnits(settlement.payout) - amountUnits(merchandise) + fees) : null;
  const money = (value: string | null) => rupiah(value === null ? null : Number(value));
  return <Card className="detail-summary"><div className="card-heading"><h2>Net profit</h2>{result.quality === "ESTIMATED" && <Badge tone="orange">Estimated</Badge>}</div><dl>
    <div><dt>Merchandise</dt><dd>{money(merchandise)}</dd></div>
    {settlement && <>
      <div><dt>Shopee commission</dt><dd>{money(amountString(-amountUnits(settlement.commission)))}</dd></div>
      <div><dt>Service fees</dt><dd>{money(amountString(-amountUnits(settlement.service)))}</dd></div>
      <div><dt>Transaction fees</dt><dd>{money(amountString(-amountUnits(settlement.transaction)))}</dd></div>
      <div><dt>Affiliate commission</dt><dd>{money(amountString(-amountUnits(settlement.affiliate)))}</dd></div>
      <div><dt>Other fees &amp; taxes</dt><dd>{money(amountString(-amountUnits(settlement.other)))}</dd></div>
      <div><dt>Shipping, vouchers, refunds &amp; adjustments</dt><dd>{money(adjustment)}</dd></div>
    </>}
    <div><dt>Shopee payout</dt><dd>{money(result.payout)}</dd></div>
    <div><dt>COGS ({result.cogs === null ? "missing" : "all units"})</dt><dd>{result.cogs === null ? "—" : money(amountString(-amountUnits(result.cogs)))}</dd></div>
    <div className="border-t pt-3 font-semibold"><dt>Net profit</dt><dd>{money(result.profit)}</dd></div>
  </dl><p className="page-note">Payout − recorded COGS. Fees and refunds are included once. Advertising spend is separate.</p>
  {result.quality === "MISSING_COST" && <p className="page-note">Add the missing product costs to calculate profit.</p>}
  {result.quality === "MISSING_SETTLEMENT" && <p className="page-note">Waiting for Shopee payout data.</p>}
  {result.quality === "EXCLUDED" && <p className="page-note">Unpaid and cancelled orders are excluded from profit.</p>}
  {result.quality === "ESTIMATED" && <p className="page-note">This order is in progress or uses an estimated historical cost.</p>}
  <p className="page-note">Payout last refreshed: {timeLabel(observedAt)}</p><FinanceSyncButton shopId={shopId} orderSn={orderSn}/></Card>;
}
