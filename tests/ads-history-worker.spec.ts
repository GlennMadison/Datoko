import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../src/core/errors.ts";
import { shiftDate } from "../src/core/reporting-period.ts";
let state: any, raw: any[], requested: string[], saved: any[], expired = false, apiError: any, generation = 1;
const db: any = {
 shop: { findFirst: async () => ({id:"shop",currency:"IDR",sourceShopId:"1",environment:"production"}) },
 syncState: { findUnique: async () => state, update: async ({data}: any) => Object.assign(state,data) },
 $queryRaw: async () => [{version:generation,status:"CONNECTED"}],
 $transaction: async (fn: any) => fn(db),
};
mock.module("../src/server/db.ts",{namedExports:{getDb:()=>db}});
mock.module("../src/server/env.ts",{namedExports:{getConfig:()=>({SHOPEE_ENV:"production"}),partnerConfig:()=>({}),isDemo:()=>false}});
mock.module("../src/server/connections.ts",{namedExports:{withShopLock:async (_:any,fn:any)=>fn(),accessForShop:async()=>({accessToken:"test",sourceShopId:"1"})}});
mock.module("../src/server/shopee-client.ts",{namedExports:{ShopeeClient:class {
 async adsDaily(_a:any,_b:any,from:string,to:string) {requested=[from,to];if(expired){expired=false;throw new AppError("SHOPEE_ACCESS_EXPIRED",401);}if(apiError)throw apiError;return raw;}
}}});
mock.module("../src/server/ads.ts",{namedExports:{importSyncedAdReport:async (_s:any,_g:any,rows:any[])=>{saved.push(...rows);return {imported:rows.length,unchanged:0};}}});
const {syncShopAdsHistory}=await import("../src/server/ads-sync.ts");
function reset() {
 state={id:"history",checkpoint:new Date("2026-05-01T00:00:00+07:00"),lastErrorCode:null};
 raw=[]; for(let d="2026-05-01";d<="2026-05-30";d=shiftDate(d,1)) raw.push({date:d.split("-").reverse().join("-"),expense:10,broad_gmv:20});
 requested=[];saved=[];apiError=null;expired=false;generation=1;
}
test("imports a bounded window and resumes at the next day",async()=>{reset();const r=await syncShopAdsHistory("shop",1);assert.equal(r.imported,30);assert.deepEqual(requested,["2026-05-01","2026-05-30"]);assert.equal(state.checkpoint.toISOString(),"2026-05-30T17:00:00.000Z");assert.equal(state.lastErrorCode,null);});
test("empty and partial source responses preserve checkpoint and record a gap",async()=>{for(const rows of [[],raw.slice(0,2)]){reset();raw=rows;const before=state.checkpoint.toISOString();const r=await syncShopAdsHistory("shop",1);assert.equal(r.failed,1);assert.equal(state.lastErrorCode,"ADS_HISTORY_INCOMPLETE");assert.equal(state.checkpoint.toISOString(),before);}});
test("API history denial is recorded without a checkpoint advance",async()=>{reset();apiError=new AppError("SHOPEE_PERMISSION_DENIED",403);const r=await syncShopAdsHistory("shop",1);assert.equal(r.failed,1);assert.equal(saved.length,0);assert.equal(state.lastErrorCode,"SHOPEE_PERMISSION_DENIED");});
test("expired access is refreshed and the same range is retried",async()=>{reset();expired=true;assert.equal((await syncShopAdsHistory("shop",1)).completed,1);});
test("paused or failed requests do not call Shopee again",async()=>{reset();await syncShopAdsHistory("shop",1,{shouldPause:()=>true});assert.deepEqual(requested,[]);state.lastErrorCode="ADS_HISTORY_INCOMPLETE";await syncShopAdsHistory("shop",1);assert.deepEqual(requested,[]);});
test("reconnection fences checkpoint writes",async()=>{reset();generation=2;await assert.rejects(syncShopAdsHistory("shop",1),{code:"CONNECTION_CHANGED"});});
