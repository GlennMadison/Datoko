import { z } from "zod";
import { SHOPEE_HOSTS, signRequest, parseSourceJson, externalId, type PartnerConfig } from "../core/shopee.ts";
import { AppError } from "../core/errors.ts";
import type { TokenPair, ShopIdentity } from "../core/authorization.ts";

import { adsDate } from "../core/shopee-ads.ts";

const envelope = z.object({ error: z.unknown().optional(), request_id: z.string().optional(), response: z.unknown().optional() }).passthrough();
const object = z.record(z.string(), z.unknown());

function numericShopId(shopId: string): number {
  const value = Number(externalId(shopId));
  if (!Number.isSafeInteger(value)) throw new AppError("UNSUPPORTED_SHOP_ID_SIZE");
  return value;
}

export class ShopeeClient {
  private readonly config: PartnerConfig;
  constructor(config: PartnerConfig) { this.config = config; }

  private async request(path: string, input: { accessToken?: string; shopId?: string; query?: Record<string, string>; body?: Record<string, unknown> } = {}): Promise<unknown> {
    const timestamp = Math.floor(Date.now() / 1000);
    const url = new URL(path, SHOPEE_HOSTS[this.config.environment]);
    url.search = new URLSearchParams({ partner_id: this.config.partnerId, timestamp: String(timestamp), sign: signRequest({ ...this.config, path, timestamp, accessToken: input.accessToken, shopId: input.shopId }), ...input.query }).toString();
    if (input.accessToken) url.searchParams.set("access_token", input.accessToken);
    if (input.shopId) url.searchParams.set("shop_id", input.shopId);
    let response: Response;
    try {
      response = await fetch(url, { method: input.body ? "POST" : "GET", headers: input.body ? { "Content-Type": "application/json" } : undefined, body: input.body ? JSON.stringify(input.body) : undefined, signal: AbortSignal.timeout(20_000), cache: "no-store", redirect: "error" });
    } catch { throw new AppError("SHOPEE_REQUEST_UNCERTAIN", 502); }
    if (response.status === 429) throw new AppError("SHOPEE_RATE_LIMIT", 429);
    if (response.status === 403) throw new AppError("SHOPEE_PERMISSION_DENIED", 403);
    if (!response.ok) throw new AppError("SHOPEE_HTTP_ERROR", 502);
    const parsed = envelope.safeParse(parseSourceJson(await response.text()));
    if (!parsed.success) throw new AppError("INVALID_SHOPEE_RESPONSE", 502);
    if (parsed.data.error) {
      const code = String(parsed.data.error);
      if (/rate_limit/.test(code)) throw new AppError("SHOPEE_RATE_LIMIT", 429);
      if (/access_token|invalid_acce|invalid_token|token_expired/.test(code)) throw new AppError("SHOPEE_ACCESS_EXPIRED", 401);
      if (/refresh_token|invalid_refresh/.test(code)) throw new AppError("SHOPEE_RECONNECT_REQUIRED", 401);
      if (/permission|no_auth|no_permission/.test(code) || /permission|not authorized|not authorised|no access/i.test(String(parsed.data.message ?? ""))) throw new AppError("SHOPEE_PERMISSION_DENIED", 403);
      if (path.startsWith("/api/v2/ads/") && /^[a-zA-Z0-9_.-]{1,100}$/.test(code)) console.error(JSON.stringify({ event: "shopee_ads_api_error", path, providerCode: code }));
      throw new AppError("SHOPEE_API_ERROR", 502);
    }
    if (path.startsWith("/api/v2/ads/") && parsed.data.warning) throw new AppError("SHOPEE_ADS_WARNING", 502);
    return parsed.data.response ?? parsed.data;
  }


  async call(path: string, input: { accessToken?: string; shopId?: string; query?: Record<string, string>; body?: Record<string, unknown> } = {}): Promise<Record<string, unknown>> {
    return object.parse(await this.request(path, input));
  }
  async adsDaily(accessToken: string, shopId: string, from: string, to: string) {
    return z.array(object).parse(await this.request("/api/v2/ads/get_all_cpc_ads_daily_performance", { accessToken, shopId, query: { start_date: adsDate(from), end_date: adsDate(to) } }));
  }
  async adsHourly(accessToken: string, shopId: string, date: string) {
    return z.array(object).parse(await this.request("/api/v2/ads/get_all_cpc_ads_hourly_performance", { accessToken, shopId, query: { performance_date: adsDate(date) } }));
  }
  async adsCampaigns(accessToken: string, shopId: string, offset: number) {
    const raw = await this.request("/api/v2/ads/get_product_level_campaign_id_list", { accessToken, shopId, query: { ad_type: "all", offset: String(offset), limit: "100" } });
    const schema = z.object({ shop_id: z.union([z.string(), z.number()]), region: z.literal("ID"), has_next_page: z.boolean(), campaign_list: z.array(z.object({ campaign_id: z.union([z.string(), z.number()]) })) });
    const checked = schema.safeParse(raw);
    if (!checked.success) {
      console.error(JSON.stringify({ event: "ads_campaign_response_invalid", keys: raw && typeof raw === "object" ? Object.keys(raw) : [], issues: checked.error.issues.map(i => ({ path: i.path.join("."), code: i.code, message: i.message })) }));
      throw new AppError("INVALID_ADS_CAMPAIGN_RESPONSE", 502);
    }
    const parsed = checked.data;
    if (externalId(parsed.shop_id) !== shopId) throw new AppError("ADS_SOURCE_SHOP_MISMATCH", 502);
    return { more: parsed.has_next_page, ids: parsed.campaign_list.map(c => externalId(c.campaign_id)) };
  }
  async adsCampaignDaily(accessToken: string, shopId: string, from: string, to: string, ids: string[]) {
    const path = "/api/v2/ads/get_product_campaign_daily_performance";
    const raw = await this.request(path, { accessToken, shopId, query: { start_date: adsDate(from), end_date: adsDate(to), campaign_id_list: ids.join(",") } });
    // Shopee versions use either a single shop object or a list of shops.
    // Membership and region are checked again by normalizeCampaignAds.
    const shape = z.union([z.array(object), z.object({ shop_id: z.union([z.string(), z.number()]), region: z.string(), campaign_list: z.array(object) }).passthrough()]).safeParse(raw);
    if (!shape.success) {
      console.error(JSON.stringify({ event: "ads_campaign_performance_invalid", keys: raw && typeof raw === "object" ? Object.keys(raw) : [], issues: shape.error.issues.map(i => ({ path: i.path.join("."), code: i.code })) }));
      throw new AppError("INVALID_ADS_CAMPAIGN_RESPONSE", 502);
    }
    return Array.isArray(shape.data) ? shape.data : [shape.data];
  }

  private tokenPair(raw: Record<string, unknown>): TokenPair {
    const parsed = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1) }).parse(raw);
    const expiresIn = z.number().int().min(60).max(86400).parse(raw.expire_in ?? raw.expires_in);
    return { accessToken: parsed.access_token, refreshToken: parsed.refresh_token, expiresIn };
  }

  async exchange(code: string, shopId: string): Promise<TokenPair> {
    return this.tokenPair(await this.call("/api/v2/auth/token/get", { body: { partner_id: Number(this.config.partnerId), shop_id: numericShopId(shopId), code } }));
  }
  async refresh(refreshToken: string, shopId: string): Promise<TokenPair> {
    return this.tokenPair(await this.call("/api/v2/auth/access_token/get", { body: { partner_id: Number(this.config.partnerId), shop_id: numericShopId(shopId), refresh_token: refreshToken } }));
  }
  async identify(tokens: TokenPair, shopId: string): Promise<ShopIdentity> {
    const raw = await this.call("/api/v2/shop/get_shop_info", { accessToken: tokens.accessToken, shopId });
    if (raw.region !== "ID") throw new AppError("UNSUPPORTED_SHOP_REGION", 403);
    // A successful token-scoped shop request verifies access even when the API
    // omits shop_id from its response. The ID was already checked against our allowlist.
    return { shopId: raw.shop_id ? externalId(raw.shop_id) : shopId, name: z.string().min(1).parse(raw.shop_name), currency: "IDR" };
  }
  async returnList(accessToken: string, shopId: string, from: Date, to: Date, offset: number) {
    const raw = await this.call("/api/v2/returns/get_return_list", { accessToken, shopId, query: { update_time_from: String(Math.floor(from.getTime() / 1000)), update_time_to: String(Math.floor(to.getTime() / 1000)), page_no: String(offset), page_size: "50" } });
    const parsed = z.object({ more: z.boolean(), return: z.array(object) }).parse(raw);
    return { more: parsed.more, returns: parsed.return };
  }
  async returnDetail(accessToken: string, shopId: string, returnSn: string) {
    return this.call("/api/v2/returns/get_return_detail", { accessToken, shopId, query: { return_sn: returnSn } });
  }
  async escrowDetail(accessToken: string, shopId: string, orderSn: string) {
    return this.call("/api/v2/payment/get_escrow_detail", { accessToken, shopId, query: { order_sn: orderSn } });
  }
  async orderList(accessToken: string, shopId: string, from: Date, to: Date, cursor: string | null) {
    const raw = await this.call("/api/v2/order/get_order_list", { accessToken, shopId, query: { time_range_field: "update_time", time_from: String(Math.floor(from.getTime() / 1000)), time_to: String(Math.floor(to.getTime() / 1000)), page_size: "50", ...(cursor ? { cursor } : {}) } });
    const parsed = z.object({ order_list: z.array(z.object({ order_sn: z.string() })), more: z.boolean(), next_cursor: z.string().optional() }).parse(raw);
    if (parsed.more && !parsed.next_cursor) throw new AppError("MISSING_SOURCE_CURSOR", 502);
    return { orderSns: parsed.order_list.map(order => order.order_sn), nextCursor: parsed.more ? parsed.next_cursor! : null };
  }
  async orderDetails(accessToken: string, shopId: string, orderSns: string[]): Promise<unknown[]> {
    if (!orderSns.length) return [];
    const raw = await this.call("/api/v2/order/get_order_detail", { accessToken, shopId, query: { order_sn_list: orderSns.join(","), response_optional_fields: "total_amount,item_list,pay_time,cancel_reason,cancel_by" } });
    const orders = z.array(object).parse(raw.order_list);
    const returned = new Set(orders.map(order => order.order_sn));
    if (orderSns.some(sn => !returned.has(sn))) throw new AppError("INCOMPLETE_ORDER_DETAILS", 502);
    return orders;
  }
}
