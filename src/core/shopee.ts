import { createHmac } from "node:crypto";
import { AppError } from "./errors.ts";

export type ShopeeEnvironment = "sandbox" | "production";
export type PartnerConfig = { environment: ShopeeEnvironment; partnerId: string; partnerKey: string };

export const SHOPEE_HOSTS = {
  sandbox: "https://openplatform.sandbox.test-stable.shopee.sg",
  production: "https://partner.shopeemobile.com",
} as const;

export function externalId(value: unknown): string {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) throw new AppError("UNSAFE_SOURCE_ID");
  const result = String(value ?? "");
  if (!/^\d{1,30}$/.test(result)) throw new AppError("INVALID_SOURCE_ID");
  return result;
}

export function signRequest(input: PartnerConfig & { path: string; timestamp: number; accessToken?: string; shopId?: string }): string {
  const { partnerId, partnerKey, path, timestamp, accessToken, shopId } = input;
  if (!/^\d+$/.test(partnerId) || !path.startsWith("/api/v2/") || !Number.isSafeInteger(timestamp)) throw new AppError("INVALID_SIGNATURE_INPUT");
  if (Boolean(accessToken) !== Boolean(shopId)) throw new AppError("INCOMPLETE_SHOP_SIGNATURE");
  const base = partnerId + path + timestamp + (accessToken ?? "") + (shopId ?? "");
  return createHmac("sha256", partnerKey).update(base).digest("hex");
}

export function authorizationUrl(input: PartnerConfig & { callbackUrl: string; state: string; timestamp: number }): string {
  const callback = new URL(input.callbackUrl);
  if (input.environment === "production" && callback.protocol !== "https:") throw new AppError("HTTPS_CALLBACK_REQUIRED");
  if (input.environment === "sandbox") {
    const url = new URL("https://open.sandbox.test-stable.shopee.com/auth");
    url.search = new URLSearchParams({ partner_id: input.partnerId, auth_type: "seller", redirect_uri: callback.toString(), response_type: "code", state: input.state }).toString();
    return url.toString();
  }
  callback.searchParams.set("auth_state", input.state);
  const path = "/api/v2/shop/auth_partner";
  const url = new URL(path, SHOPEE_HOSTS[input.environment]);
  url.search = new URLSearchParams({ partner_id: input.partnerId, timestamp: String(input.timestamp), sign: signRequest({ ...input, path }), redirect: callback.toString() }).toString();
  return url.toString();
}

export function parseSourceJson(text: string): unknown {
  // Node 24's JSON reviver context preserves the original source for large IDs.
  return JSON.parse(text, (key, value: unknown, context?: { source?: string }) => {
    if (typeof value !== "number") return value;
    if ((!Number.isSafeInteger(value) && Number.isInteger(value)) || /(?:price|amount|fee|cost)$/.test(key)) {
      if (!context?.source) throw new AppError("LOSSLESS_JSON_UNAVAILABLE", 503);
      return context.source;
    }
    return value;
  });
}
