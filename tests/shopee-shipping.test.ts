import { test } from "node:test";
import assert from "node:assert/strict";
import { ShopeeClient } from "../src/server/shopee-client.ts";
const client = new ShopeeClient({ environment:"sandbox", partnerId:"42", partnerKey:"fixture" });
test("logistics requests are shop-signed, use exact package IDs, and send one shipment POST", async t => {
  const requests: {url:URL; options:RequestInit}[]=[];
  t.mock.method(globalThis,"fetch",async(url:URL,options:RequestInit)=>{
    requests.push({url:new URL(url),options});
    return new Response(JSON.stringify({error:"",response:url.pathname.endsWith("get_order_detail")?{order_list:[{order_sn:"TEST"}]}:{}}));
  });
  await client.shippingChannels("fixture-token","123");
  await client.shippingAddresses("fixture-token","123");
  await client.processingOrder("fixture-token","123","TEST");
  await client.shippingParameters("fixture-token","123","TEST","PKG");
  await client.arrangeShipment("fixture-token","123",{order_sn:"TEST",package_number:"PKG",pickup:{address_id:77,pickup_time_id:"slot"}});
  assert.equal(requests.length,5);
  for(const request of requests) {
    assert.equal(request.url.searchParams.get("shop_id"),"123");
    assert.equal(request.url.searchParams.get("access_token"),"fixture-token");
    assert.equal(request.url.searchParams.get("sign")?.length,64);
  }
  assert.equal(requests[2].url.searchParams.get("response_optional_fields"),"pay_time,cod,package_list,shipping_carrier");
  assert.equal(requests[3].url.searchParams.get("package_number"),"PKG");
  assert.equal(requests[4].options.method,"POST");
  assert.deepEqual(JSON.parse(String(requests[4].options.body)).pickup,{address_id:77,pickup_time_id:"slot"});
});
test("ambiguous shipment failure is never retried by the transport", async t=>{
  let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;throw new Error("lost response");});
  await assert.rejects(client.arrangeShipment("fixture-token","123",{order_sn:"TEST",dropoff:{}}),{code:"SHOPEE_REQUEST_UNCERTAIN"});
  assert.equal(calls,1);
});
