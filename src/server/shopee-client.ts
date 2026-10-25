import { z } from "zod";
import { SHOPEE_HOSTS, signRequest, parseSourceJson, externalId, type PartnerConfig } from "../core/shopee.ts";
import { AppError } from "../core/errors.ts";
import type { TokenPair, ShopIdentity } from "../core/authorization.ts";

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

  async call(path: string, input: { accessToken?: string; shopId?: string; query?: Record<string, string>; body?: Record<string, unknown> } = {}): Promise<Record<string, unknown>> {
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
    if (!response.ok) throw new AppError("SHOPEE_HTTP_ERROR", 502);
    const parsed = envelope.safeParse(parseSourceJson(await response.text()));
    if (!parsed.success) throw new AppError("INVALID_SHOPEE_RESPONSE", 502);
    if (parsed.data.error) {
      const code = String(parsed.data.error);
      if (/access_token|invalid_acce|invalid_token|token_expired/.test(code)) throw new AppError("SHOPEE_ACCESS_EXPIRED", 401);
      if (/refresh_token|invalid_refresh/.test(code)) throw new AppError("SHOPEE_RECONNECT_REQUIRED", 401);
      if (/permission|no_auth|no_permission/.test(code)) throw new AppError("SHOPEE_PERMISSION_DENIED", 403);
      throw new AppError("SHOPEE_API_ERROR", 502);
    }
    return object.parse(parsed.data.response ?? parsed.data);
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
  async returnList(accessToken: string, shopId: string, from: Date, to: Date, page: number) {
    const raw = await this.call("/api/v2/returns/get_return_list", { accessToken, shopId, query: { update_time_from: String(Math.floor(from.getTime() / 1000)), update_time_to: String(Math.floor(to.getTime() / 1000)), page_no: String(page), page_size: "50" } });
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
