import { test } from "node:test";
import assert from "node:assert/strict";
import { courierCatalog, pickupAddresses, orderChannelId, shipmentPlan, type CourierRule } from "../src/core/courier-shipping.ts";
import { arrangeShipment, type ShipmentDependencies, type ProcessingState } from "../src/core/shipment-workflow.ts";

const now = new Date("2026-10-27T12:00:00Z"), enabledFrom = new Date("2026-10-27T08:00:00Z");
const rule: CourierRule = { channelId: "123", enabled: true, enabledFrom, method: "dropoff", pickupAddressId: "77", fallbackDropoff: false, branchId: null, senderRealName: null };
const order = { order_sn: "TEST", order_status: "READY_TO_SHIP", create_time: now.getTime()/1000 - 7200, pay_time: now.getTime()/1000 - 7100, cod: false, package_list: [{ logistics_channel_id: 123, package_number: "PKG" }] };
const pickup = { info_needed: { pickup: ["address_id", "pickup_time_id"], dropoff: [] }, pickup: { address_list: [{ address_id: 77, time_slot_list: [
  { pickup_time_id: "old", date: now.getTime()/1000 - 172800 },
  { pickup_time_id: "early", date: now.getTime()/1000 },
  { pickup_time_id: "recommended", date: now.getTime()/1000, flags: ["recommended"] },
] }] } };
test("courier catalog preserves distinct regular and same-day IDs, including disabled services", () => {
  const c = courierCatalog({ logistics_channel_list: [
    { logistics_channel_id: 123, logistics_channel_name: "Anteraja Reguler", enabled: true },
    { logistics_channel_id: 124, logistics_channel_name: "Anteraja Same Day", enabled: false },
  ] });
  assert.equal(c.length, 2); assert.notEqual(c[0].id, c[1].id);
  assert.throws(() => courierCatalog({ logistics_channel_list: [{ logistics_channel_id: Number.MAX_SAFE_INTEGER + 1, enabled: true }] }));
});
test("only pickup-flagged supported addresses are offered", () => {
  assert.deepEqual(pickupAddresses({ address_list: [
    { address_id: 77, address_flag: ["pickup_address"], address: "Shop", city: "Jakarta" },
    { address_id: 78, address_flag: ["return_address"] },
    { address_id: 79, address_flag: ["pickup_address"], address_status: "DISABLED" },
  ] }), [{ id: "77", label: "Shop, Jakarta" }]);
});
test("shipping cannot match courier by name or conflict with package service ID", () => {
  assert.equal(orderChannelId(order), "123");
  assert.equal(orderChannelId({ shipping_carrier: "Anteraja" }), null);
  assert.equal(orderChannelId({ ...order, logistics_channel_id: 124 }), null);
});
test("drop-off sends its explicit supported empty body and package number", () => {
  assert.deepEqual(shipmentPlan("TEST", { info_needed: { dropoff: [] } }, rule, now, "PKG"), { method: "dropoff", body: { order_sn: "TEST", package_number: "PKG", dropoff: {} } });
  assert.throws(() => shipmentPlan("TEST", {}, rule, now));
});
test("pickup selects the configured supported address and recommended nonexpired slot", () => {
  assert.deepEqual(shipmentPlan("TEST", pickup, { ...rule, method: "pickup" }, now).body, { order_sn: "TEST", pickup: { address_id: 77, pickup_time_id: "recommended" } });
});
test("unavailable pickup never silently falls back; explicit fallback needs available drop-off", () => {
  for (const params of [{ info_needed: { dropoff: [] } }, { ...pickup, pickup: { address_list: [] } }]) {
    assert.throws(() => shipmentPlan("TEST", params, { ...rule, method: "pickup" }, now), { code: "PICKUP_UNAVAILABLE" });
    assert.equal(shipmentPlan("TEST", params, { ...rule, method: "pickup", fallbackDropoff: true }, now).method, "dropoff");
  }
  assert.throws(() => shipmentPlan("TEST", { info_needed: { pickup: ["address_id"] } }, { ...rule, method: "pickup", fallbackDropoff: true }, now), { code: "DROPOFF_UNAVAILABLE" });
});
test("pickup slots are optional only when Shopee does not require a time ID", () => {
  const params = { info_needed: { pickup: ["address_id"] }, pickup: { address_list: [{ address_id: 77, time_slot_list: [] }] } };
  assert.deepEqual(shipmentPlan("TEST", params, { ...rule, method: "pickup" }, now).body, { order_sn: "TEST", pickup: { address_id: 77 } });
  assert.throws(() => shipmentPlan("TEST", { ...params, info_needed: { pickup: ["address_id", "pickup_time_id"] } }, { ...rule, method: "pickup" }, now), { code: "PICKUP_UNAVAILABLE" });
});
test("unknown requirements and unverified drop-off branches require manual handling", () => {
  assert.throws(() => shipmentPlan("TEST", { info_needed: { pickup: ["tracking_number"] } }, { ...rule, method: "pickup", fallbackDropoff: true }, now), { code: "PICKUP_DETAILS_REQUIRED" });
  const params = { info_needed: { dropoff: ["branch_id", "sender_real_name"] }, dropoff: { branch_list: [{ branch_id: 42 }] } };
  assert.throws(() => shipmentPlan("TEST", params, rule, now));
  assert.throws(() => shipmentPlan("TEST", params, { ...rule, branchId: "99", senderRealName: "Seller" }, now));
  assert.deepEqual(shipmentPlan("TEST", params, { ...rule, branchId: "42", senderRealName: " Seller " }, now).body, { order_sn: "TEST", dropoff: { branch_id: 42, sender_real_name: "Seller" } });
});
function fixture() {
  const states: { state: ProcessingState; code?: string }[] = [];
  let writes = 0, reads = 0, claimed = false;
  const deps: ShipmentDependencies = {
    readOrder: async () => { reads++; return { ...order }; },
    readRule: async id => id === rule.channelId ? rule : null,
    readParameters: async () => ({ info_needed: { dropoff: [] } }),
    claimRequest: async () => { if (claimed) return false; claimed = true; return true; },
    send: async () => { writes++; return {}; },
    save: async (state, code) => { states.push({ state, code }); },
  };
  return { deps, states, get writes(){return writes;}, get reads(){return reads;} };
}
test("shipment is sent only once even on overlapping processing attempts", async () => {
  const f=fixture(); await Promise.all([arrangeShipment("TEST", enabledFrom, f.deps, now), arrangeShipment("TEST", enabledFrom, f.deps, now)]);
  assert.equal(f.writes,1); assert.equal(f.states.filter(s=>s.state==="ARRANGED").length,1);
});
test("only enabled exact courier service can ship, never same-day by similar name", async () => {
  for (const patch of [{ ...order, package_list:[{logistics_channel_id:124,package_number:"PKG"}] }, order]) {
    const f=fixture(); f.deps.readOrder=async()=>patch;
    if (patch===order) f.deps.readRule=async()=>({...rule,enabled:false});
    await arrangeShipment("TEST",enabledFrom,f.deps,now);
    assert.equal(f.writes,0); assert.equal(f.states.at(-1)?.code,"COURIER_DISABLED");
  }
});
test("courier activation cannot sweep in existing orders", async () => {
  const f=fixture(); f.deps.readRule=async()=>({...rule,enabledFrom:new Date(now.getTime()-1000)});
  await arrangeShipment("TEST",enabledFrom,f.deps,now);
  assert.equal(f.writes,0); assert.equal(f.states.at(-1)?.code,"ORDER_BEFORE_ACTIVATION");
});
test("unpaid, COD, cancelled, processed, split and recently paid orders never ship", async () => {
  for (const patch of [{order_status:"UNPAID"},{cod:true},{order_status:"IN_CANCEL"},{order_status:"PROCESSED"},{package_list:[{},{}]},{pay_time:now.getTime()/1000-10}]) {
    const f=fixture(); f.deps.readOrder=async()=>({...order,...patch});
    await arrangeShipment("TEST",enabledFrom,f.deps,now); assert.equal(f.writes,0);
  }
});
test("cancellation, service change or package change between reads stops the write", async () => {
  for (const patch of [{order_status:"CANCELLED"},{package_list:[{logistics_channel_id:124,package_number:"PKG"}]},{package_list:[{logistics_channel_id:123,package_number:"CHANGED"}]}]) {
    const f=fixture(); let reads=0;
    f.deps.readOrder=async()=>++reads===1?order:{...order,...patch};
    await arrangeShipment("TEST",enabledFrom,f.deps,now); assert.equal(f.writes,0); assert.equal(f.states.at(-1)?.state,"SKIPPED");
  }
});
test("unavailable pickup waits for another read without claiming or sending", async () => {
  const f=fixture(); f.deps.readRule=async()=>({...rule,method:"pickup"});
  let claims=0; f.deps.claimRequest=async()=>{claims++;return true;};
  await arrangeShipment("TEST",enabledFrom,f.deps,now);
  assert.equal(f.writes,0); assert.equal(claims,0); assert.deepEqual(f.states.at(-1),{state:"WAITING",code:"PICKUP_UNAVAILABLE"});
});
test("lost shipment or database acknowledgement never triggers another external write", async () => {
  for(const stage of ["send","claim","save"]) {
    const f=fixture();
    if(stage==="send") f.deps.send=async()=>{throw new Error("timeout");};
    if(stage==="claim") f.deps.claimRequest=async()=>{throw new Error("lost database response");};
    if(stage==="save") {const save=f.deps.save;f.deps.save=async(state,code)=>{if(state==="ARRANGED")throw new Error("lost db response");await save(state,code);};}
    await arrangeShipment("TEST",enabledFrom,f.deps,now);
    assert.equal(f.states.at(-1)?.state,"UNCERTAIN");
    if(stage==="claim")assert.equal(f.writes,0);
  }
});
