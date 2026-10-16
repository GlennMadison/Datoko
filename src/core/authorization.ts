import { AppError, publicErrorCode } from "./errors.ts";
import { externalId, type ShopeeEnvironment } from "./shopee.ts";
import { digest, matchesHash } from "./security.ts";

export type AuthAttempt = {
  id: string; ownerId: string; sessionHash: string; stateHash: string; browserHash: string;
  expectedShopId: string; environment: string; expiresAt: Date; status: string; returnPath: string;
};
export type CallbackInput = {
  ownerId: string; sessionId: string; browserSecret: string; environment: ShopeeEnvironment;
  state: string; code: string; shopId: string; now: Date;
};
export type TokenPair = { accessToken: string; refreshToken: string; expiresIn: number };
export type ShopIdentity = { shopId: string; name: string; currency: string };

export function callbackParameters(params: URLSearchParams): { code: string; shopId: string; state: string } {
  if (params.has("main_account_id") || params.has("merchant_id")) throw new AppError("UNSUPPORTED_AUTH_SCOPE");
  // Sandbox V2 echoes state directly. The legacy adapter nests auth_state in
  // the callback URL. Reject mixed state sources and repeated parameters.
  const stateKeys = ["state", "auth_state"].filter(key => params.has(key));
  if (stateKeys.length !== 1) throw new AppError("INVALID_CALLBACK_STATE");
  const stateKey = stateKeys[0];
  for (const key of ["code", "shop_id", stateKey]) {
    if (params.getAll(key).length !== 1 || !params.get(key)) throw new AppError("INVALID_CALLBACK");
  }
  const code = params.get("code")!;
  const state = params.get(stateKey)!;
  if (code.length > 2048 || code.length < 8 || /[\x00-\x20]/.test(code)) throw new AppError("INVALID_CALLBACK");
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new AppError("INVALID_CALLBACK_STATE");
  return { code, shopId: externalId(params.get("shop_id")), state };
}

export function validateAttempt(attempt: AuthAttempt, input: CallbackInput): void {
  if (attempt.ownerId !== input.ownerId || !matchesHash(input.sessionId, attempt.sessionHash)) throw new AppError("WRONG_AUTH_SESSION", 403);
  if (!matchesHash(input.state, attempt.stateHash) || !matchesHash(input.browserSecret, attempt.browserHash)) throw new AppError("INVALID_CALLBACK_STATE", 403);
  if (attempt.environment !== input.environment || attempt.expectedShopId !== input.shopId) throw new AppError("WRONG_AUTH_SHOP", 403);
  if (attempt.expiresAt.getTime() <= input.now.getTime()) throw new AppError("AUTH_ATTEMPT_EXPIRED");
}

export interface AuthorizationDependencies {
  claim: (attemptId: string, codeHash: string, now: Date) => Promise<boolean>;
  exchange: (code: string, shopId: string) => Promise<TokenPair>;
  identify: (tokens: TokenPair, shopId: string) => Promise<ShopIdentity>;
  persist: (attempt: AuthAttempt, tokens: TokenPair, shop: ShopIdentity, now: Date) => Promise<void>;
  fail: (attemptId: string, errorCode: string) => Promise<void>;
}

export async function completeAuthorization(attempt: AuthAttempt, input: CallbackInput, deps: AuthorizationDependencies): Promise<"connected" | "processing"> {
  validateAttempt(attempt, input);
  if (attempt.status === "SUCCEEDED") return "connected";
  if (attempt.status === "PROCESSING") return "processing";
  if (attempt.status !== "PENDING") throw new AppError("AUTH_ATTEMPT_USED");
  if (!(await deps.claim(attempt.id, digest(input.code), input.now))) return "processing";
  try {
    const tokens = await deps.exchange(input.code, input.shopId);
    const shop = await deps.identify(tokens, input.shopId);
    if (shop.shopId !== attempt.expectedShopId || shop.currency !== "IDR") throw new AppError("WRONG_AUTH_SHOP", 403);
    await deps.persist(attempt, tokens, shop, input.now);
    return "connected";
  } catch (error) {
    await deps.fail(attempt.id, publicErrorCode(error));
    throw error;
  }
}
