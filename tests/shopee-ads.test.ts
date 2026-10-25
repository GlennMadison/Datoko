import { test } from "node:test";
import assert from "node:assert/strict";
import { adsDate, adsRange, adsSyncDue, normalizeAdsMetrics, normalizeCampaignAds } from "../src/core/shopee-ads.ts";
import { parseSourceJson } from "../src/core/shopee.ts";
import { calculateRoas } from "../src/core/ads-roas.ts";
import { validateAdImport } from "../src/server/ads-import-schema.ts";
import { ShopeeClient } from "../src/server/shopee-client.ts";

const now = new Date("2026-10-25T14:00:00Z");
const range = adsRange(now);
const metric = { date: "25-10-2026", expense: "20000.1250", broad_gmv: "120000.7500", direct_gmv: "90000", broad_roas: 999 };

test("Shopee date requests and source periods use WIB across UTC midnight", () => {
  assert.equal(adsDate(range.from), "26-09-2026");
  assert.equal(adsRange(new Date("2026-10-25T18:00:00Z")).to, "2026-10-26");
  const [row] = normalizeAdsMetrics([metric], "DAY", range);
  assert.equal(row.start, "2026-10-24T17:00:00.000Z");
  assert.equal(row.end, "2026-10-25T17:00:00.000Z");
  assert.equal(row.spend, "20000.1250");
  assert.equal(row.revenue, "120000.7500");
  const checked = validateAdImport({version: 1, sourceShopId: "123", environment: "production", datasetKey: "shopee-api-test", datasetName: "Test", basis: "PLACED_TOTAL", reports: [row]}, now);
  const result = calculateRoas(checked.reports.map((r,i) => ({...r,key:String(i)})), new Map(), { requireEvidence: true, now });
  assert.equal(result.originalRoas, "6.00");
  assert.equal(result.realRoas, null);
  assert.ok(result.issues.includes("ATTRIBUTION_INCOMPLETE"));
});
test("transport preserves raw decimal money instead of binary float rounding", () => {
  const raw = parseSourceJson('{"expense":12345.6789,"broad_gmv":987654321.1234,"direct_gmv":500.0123}') as Record<string, unknown>;
  assert.equal(raw.expense, "12345.6789");
  assert.equal(raw.broad_gmv, "987654321.1234");
  assert.equal(normalizeAdsMetrics([{...metric,...raw}], "DAY", range)[0].spend, "12345.6789");
});
test("missing, invalid, duplicate and out-of-range source data cannot become zeros", () => {
  assert.deepEqual(normalizeAdsMetrics([], "DAY", range), []);
  for (const expense of [null, undefined, "", "1.23456", "-1", "NaN", 1e30]) assert.throws(() => normalizeAdsMetrics([{...metric,expense}], "DAY", range));
  assert.throws(() => normalizeAdsMetrics([metric, metric], "DAY", range), /DUPLICATE_ADS_SOURCE_PERIOD/);
  assert.throws(() => normalizeAdsMetrics([{...metric,date:"31-02-2026"}], "DAY", range));
  assert.throws(() => normalizeAdsMetrics([{...metric,date:"01-01-2026"}], "DAY", range), /ADS_SOURCE_OUTSIDE_RANGE/);
  assert.throws(() => normalizeAdsMetrics([{...metric,broad_gmv:undefined}], "DAY", range));
});
test("hourly imports retain the current hour and ignore future zeros without inventing missing hours", () => {
  const reports = normalizeAdsMetrics([{...metric,hour:20},{...metric,hour:21},{...metric,hour:22,expense:"0",broad_gmv:"0"}], "HOUR", range);
  assert.equal(reports.length, 2);
  assert.equal(reports[1].start, "2026-10-25T14:00:00.000Z");
  assert.throws(() => normalizeAdsMetrics([{...metric,hour:22}], "HOUR", range), /ADS_SOURCE_IN_FUTURE/);
  assert.throws(() => normalizeAdsMetrics([{...metric,hour:24}], "HOUR", range), /INVALID_ADS_SOURCE_HOUR/);
});
test("campaigns are scoped to the requested shop and IDs, with names and totals independent from shop totals", () => {
  const campaigns = [{shop_id:"123",region:"ID",campaign_list:[{campaign_id:"987",ad_name:"MR4 speaker stand",metrics_list:[metric]}]}];
  const rows = normalizeCampaignAds(campaigns,"123",["987"],range);
  assert.equal(rows[0].campaignKey,"campaign:987"); assert.equal(rows[0].campaignName,"MR4 speaker stand");
  assert.throws(() => normalizeCampaignAds(campaigns,"456",["987"],range), /ADS_SOURCE_SHOP_MISMATCH/);
  assert.throws(() => normalizeCampaignAds(campaigns,"123",["999"],range), /INVALID_ADS_SOURCE_CAMPAIGN/);
  assert.throws(() => normalizeCampaignAds(campaigns,"123",["987","999"],range), /INCOMPLETE_ADS_CAMPAIGNS/);
  assert.throws(() => normalizeCampaignAds([...campaigns,...campaigns],"123",["987"],range), /INVALID_ADS_SOURCE_CAMPAIGN/);
});
test("permission failures back off for six hours while a new manual request can retry", () => {
  const state={updatedAt:now,lastSuccessAt:null,lastErrorCode:"SHOPEE_PERMISSION_DENIED"};
  assert.equal(adsSyncDue(state,null,10,new Date(now.getTime()+60_000)), false);
  assert.equal(adsSyncDue(state,null,10,new Date(now.getTime()+6*3_600_000)), true);
  assert.equal(adsSyncDue(state,new Date(now.getTime()+1),10,now), true);
  assert.equal(adsSyncDue({...state,lastErrorCode:"SHOPEE_RATE_LIMIT"},null,10,new Date(now.getTime()+600_000)), true);
  assert.equal(adsSyncDue(undefined,null,10,now), true);
});
const client = new ShopeeClient({environment:"production",partnerId:"12345",partnerKey:"test-partner-key"});
test("signed Ads requests accept array responses and use the documented parameter names", async t => {
  const urls: URL[] = [];
  t.mock.method(globalThis,"fetch",async (input: URL, options: RequestInit) => {
    urls.push(new URL(input)); assert.equal(options.method,"GET");
    return new Response(JSON.stringify({error:"",response:[metric]}));
  });
  assert.equal((await client.adsDaily("test-token","123",range.from,range.to)).length,1);
  await client.adsHourly("test-token","123",range.to);
  assert.equal(urls[0].pathname,"/api/v2/ads/get_all_cpc_ads_daily_performance");
  assert.equal(urls[0].searchParams.get("start_date"),"26-09-2026");
  assert.equal(urls[0].searchParams.get("end_date"),"25-10-2026");
  assert.match(urls[0].searchParams.get("sign")!,/^[a-f0-9]{64}$/);
  assert.equal(urls[1].searchParams.get("performance_date"),"25-10-2026");
});
test("campaign discovery checks shop identity and pagination, including retained large IDs", async t => {
  t.mock.method(globalThis,"fetch",async () => new Response('{"response":{"shop_id":123,"region":"ID","has_next_page":true,"campaign_list":[{"campaign_id":987654321012345678}]}}'));
  const page=await client.adsCampaigns("test-token","123",100);
  assert.deepEqual(page,{more:true,ids:["987654321012345678"]});
  await assert.rejects(client.adsCampaigns("test-token","456",0),/ADS_SOURCE_SHOP_MISMATCH/);
});
test("ads API permission, throttling and incomplete reports surface actionable errors without provider secrets", async t => {
  let payload: Record<string,unknown>={error:"error_permission_denied",message:"access denied"};
  t.mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify(payload)));
  await assert.rejects(client.adsDaily("test-token","123",range.from,range.to),/SHOPEE_PERMISSION_DENIED/);
  payload={error:"ads.rate_limit.exceed_shop_api"};
  await assert.rejects(client.adsDaily("test-token","123",range.from,range.to),/SHOPEE_RATE_LIMIT/);
  payload={error:"",warning:"Partial report",response:[]};
  await assert.rejects(client.adsDaily("test-token","123",range.from,range.to),/SHOPEE_ADS_WARNING/);
  payload={error:"error_auth",message:"No permission to call this API"};
  await assert.rejects(client.adsDaily("test-token","123",range.from,range.to),/SHOPEE_PERMISSION_DENIED/);
});
test("campaign performance accepts shop-object and shop-list responses without mixing scopes", async t => {
  let response: unknown = {shop_id:"123",region:"ID",campaign_list:[{campaign_id:"987",ad_name:"MR4",metrics_list:[metric]}]};
  t.mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({error:"",response})));
  const single = await client.adsCampaignDaily("test-token","123",range.from,range.to,["987"]);
  assert.equal(normalizeCampaignAds(single,"123",["987"],range)[0].campaignKey,"campaign:987");
  response = [response];
  assert.deepEqual(await client.adsCampaignDaily("test-token","123",range.from,range.to,["987"]), single);
  response = {unexpected:[]};
  await assert.rejects(client.adsCampaignDaily("test-token","123",range.from,range.to,["987"]), /INVALID_ADS_CAMPAIGN_RESPONSE/);
});
