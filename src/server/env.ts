import { z } from "zod";
import { AppError } from "../core/errors.ts";
import type { PartnerConfig } from "../core/shopee.ts";

const schema = z.object({
  DATOKO_MODE: z.enum(["demo", "live"]).default("demo"),
  APP_BASE_URL: z.url().default("http://localhost:3000"),
  BUSINESS_TIMEZONE: z.string().default("Asia/Jakarta"),
  AUTH_METHOD: z.enum(["email-password", "google"]).default("email-password"),
  EMAIL_SIGNUP_ENABLED: z.enum(["true", "false"]).default("true"),
  DATABASE_URL: z.string().optional(), BETTER_AUTH_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(), GOOGLE_CLIENT_SECRET: z.string().optional(),
  OWNER_EMAIL: z.string().optional(), OWNER_GOOGLE_SUB: z.string().optional(), TOKEN_ENCRYPTION_KEY: z.string().optional(),
  SHOPEE_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  SHOPEE_PARTNER_ID: z.string().optional(), SHOPEE_PARTNER_KEY: z.string().optional(),
  SHOPEE_ALLOWED_SHOP_IDS: z.string().default(""), SHOPEE_REDIRECT_URI: z.string().optional(),
  SHOPEE_CALLBACK_QUERY_VERIFIED: z.enum(["true", "false"]).default("false"),
  SHOPEE_MAX_WINDOW_DAYS: z.coerce.number().int().min(1).max(7).default(7),
  SHOPEE_HISTORY_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  INITIAL_IMPORT_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1440).default(10),
});

export const getConfig = () => schema.parse(process.env);
export const isDemo = () => getConfig().DATOKO_MODE === "demo";
const LOGIN_KEYS = ["DATABASE_URL", "BETTER_AUTH_SECRET", "OWNER_EMAIL"] as const;

export function loginMissing(): string[] {
  const config = getConfig();
  const missing: string[] = LOGIN_KEYS.filter(key => !config[key]?.trim());
  if (config.OWNER_EMAIL?.trim() && !z.email().safeParse(config.OWNER_EMAIL.trim()).success) missing.push("OWNER_EMAIL");
  if (config.AUTH_METHOD === "google") {
    for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const) if (!config[key]?.trim()) missing.push(key);
  }
  return missing;
}

export function connectionMissing(): string[] {
  const config = getConfig();
  const missing: string[] = [...loginMissing()];
  for (const key of ["TOKEN_ENCRYPTION_KEY", "SHOPEE_PARTNER_ID", "SHOPEE_PARTNER_KEY", "SHOPEE_ALLOWED_SHOP_IDS", "SHOPEE_REDIRECT_URI"] as const) if (!config[key]?.trim()) missing.push(key);
  if (config.SHOPEE_ENV === "production" && config.SHOPEE_CALLBACK_QUERY_VERIFIED !== "true") missing.push("SHOPEE_CALLBACK_QUERY_VERIFIED");
  return missing;
}

export function liveConfig() {
  if (isDemo()) throw new AppError("DEMO_READ_ONLY", 409);
  const config = getConfig();
  if (loginMissing().length) throw new AppError("LOGIN_NOT_CONFIGURED", 503);
  if (config.BETTER_AUTH_SECRET!.length < 32) throw new AppError("AUTH_SECRET_TOO_SHORT", 503);
  if (process.env.NODE_ENV === "production" && !config.APP_BASE_URL.startsWith("https://")) throw new AppError("HTTPS_REQUIRED", 503);
  return config;
}

export function partnerConfig(): PartnerConfig {
  const config = liveConfig();
  if (connectionMissing().length) throw new AppError("SHOPEE_NOT_CONFIGURED", 503);
  if (!/^\d+$/.test(config.SHOPEE_PARTNER_ID!) || !Number.isSafeInteger(Number(config.SHOPEE_PARTNER_ID))) throw new AppError("INVALID_PARTNER_ID", 503);
  const callback = new URL(config.SHOPEE_REDIRECT_URI!);
  if (callback.origin !== new URL(config.APP_BASE_URL).origin || callback.pathname !== "/api/integrations/shopee/callback" || callback.search || callback.hash) throw new AppError("INVALID_CALLBACK_CONFIGURATION", 503);
  return { environment: config.SHOPEE_ENV, partnerId: config.SHOPEE_PARTNER_ID!, partnerKey: config.SHOPEE_PARTNER_KEY! };
}
